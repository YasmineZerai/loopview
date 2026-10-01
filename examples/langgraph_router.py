"""Example 2: a LangGraph agent with conditional routing and loops, instrumented
with the standard OpenInference LangChain instrumentor.

Graph:
    START -> classify --(simple)--> answer ---------------------------> END
                      \--(needs tools)--> agent <-> tools   (tool loop)
                                          agent -> review --(revise)--> agent
                                                         \--(approved)--> END

The reviewer always asks for one revision, so the run shows a loop back to an
earlier node.

Run:  uv run python langgraph_router.py
"""

from datetime import date
from typing import Annotated, Literal, TypedDict

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AnyMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from openinference.instrumentation.langchain import LangChainInstrumentor

from shared import model_name, setup_tracing

QUESTION = (
    "How many days are there from 2026-09-30 until the next February 29th, "
    "and what day of the week will that February 29th be?"
)


@tool
def days_between(start: str, end: str) -> int:
    """Number of days from start to end. Dates are ISO strings like 2026-09-30."""
    return (date.fromisoformat(end) - date.fromisoformat(start)).days


@tool
def weekday(day: str) -> str:
    """Day of the week for an ISO date like 2028-02-29."""
    return date.fromisoformat(day).strftime("%A")


@tool
def is_leap_year(year: int) -> bool:
    """Whether a year is a leap year."""
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


TOOLS = [days_between, weekday, is_leap_year]


class State(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    route: str
    reviews: int


def build_graph():  # type: ignore[no-untyped-def]
    llm = ChatAnthropic(model=model_name(), max_tokens=1024)
    llm_with_tools = llm.bind_tools(TOOLS)

    def classify(state: State) -> dict:
        prompt = [
            SystemMessage("Reply with exactly one word: 'simple' if the question can be "
                          "answered without calculation, otherwise 'tools'."),
            state["messages"][0],
        ]
        answer = llm.invoke(prompt).content
        return {"route": "tools" if "tools" in str(answer).lower() else "simple"}

    def answer(state: State) -> dict:
        return {"messages": [llm.invoke(state["messages"])]}

    def agent(state: State) -> dict:
        system = SystemMessage("Answer the question. Use the tools for every date calculation.")
        return {"messages": [llm_with_tools.invoke([system, *state["messages"]])]}

    def review(state: State) -> dict:
        reviews = state.get("reviews", 0) + 1
        if reviews == 1:
            feedback = llm.invoke([
                SystemMessage("You are a strict reviewer. In one sentence, ask the author to "
                              "double-check one specific claim in this answer with a tool."),
                HumanMessage(str(state["messages"][-1].content)),
            ]).content
            return {"reviews": reviews, "messages": [HumanMessage(f"Reviewer: {feedback}")]}
        return {"reviews": reviews}

    def after_classify(state: State) -> Literal["answer", "agent"]:
        return "agent" if state["route"] == "tools" else "answer"

    def after_review(state: State) -> Literal["agent", "__end__"]:
        return "agent" if state["reviews"] < 2 else END

    graph = StateGraph(State)
    graph.add_node("classify", classify)
    graph.add_node("answer", answer)
    graph.add_node("agent", agent)
    graph.add_node("tools", ToolNode(TOOLS))
    graph.add_node("review", review)
    graph.add_edge(START, "classify")
    graph.add_conditional_edges("classify", after_classify)
    graph.add_edge("answer", END)
    # tools_condition goes to "tools" when the model asked for a tool, else to END;
    # we send the "done" case to the reviewer instead.
    graph.add_conditional_edges("agent", tools_condition, {"tools": "tools", END: "review"})
    graph.add_edge("tools", "agent")
    graph.add_conditional_edges("review", after_review)
    return graph.compile()


def main() -> None:
    provider = setup_tracing("langgraph-router-example")
    LangChainInstrumentor().instrument(tracer_provider=provider)
    result = build_graph().invoke({"messages": [HumanMessage(QUESTION)], "reviews": 0})
    print(result["messages"][-1].content)
    provider.shutdown()


if __name__ == "__main__":
    main()
