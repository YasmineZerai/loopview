"""The flagship demo: one LangGraph run that exercises every loopview feature.

    supervisor --+--> benchmarks_analyst --+
                 +--> operations_analyst --+--> synthesize --> critic --(revise once)--> synthesize
                 +--> ecosystem_analyst  --+                         \--(approved)--> writer --> END

- supervisor: plans, writing one brief per analyst.
- three analysts run in parallel; each is its own agent (a ReAct subgraph with
  a model node and a tool node) calling two or three tools.
- fetch_repo_stats fails on its first call, so an error and a retry show up.
- the critic sends the synthesis back once, so a loop shows up.
- writer: an agent that the critic hands off to, producing the final answer.

Instrumented with the standard OpenInference LangChain instrumentor, nothing else.

Run live (needs ANTHROPIC_API_KEY):  uv run python -m demo.flagship
"""

from typing import Annotated, Literal, TypedDict

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AnyMessage, HumanMessage, SystemMessage
from langchain_core.tools import BaseTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from openinference.instrumentation.langchain import LangChainInstrumentor
from pydantic import BaseModel, Field

from demo import tools as t
from shared import model_name, setup_tracing

TASK = (
    "Compare PostgreSQL, SQLite and DuckDB for a small internal analytics dashboard: "
    "5 users, about 20 GB of event data, loaded once a day. Recommend one."
)


# --- a small reusable ReAct agent, built as its own subgraph -------------------------


class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]


def build_agent(name: str, instructions: str, tools: list[BaseTool], llm: ChatAnthropic):
    """model <-> tools loop, compiled as a named subgraph."""
    llm_with_tools = llm.bind_tools(tools)

    def model(state: AgentState) -> dict:
        return {"messages": [llm_with_tools.invoke([SystemMessage(instructions), *state["messages"]])]}

    graph = StateGraph(AgentState)
    graph.add_node("model", model)
    # handle_tool_errors=True: a failing tool becomes an error message to the model,
    # which can then retry, instead of crashing the graph.
    graph.add_node("tools", ToolNode(tools, handle_tool_errors=True))
    graph.add_edge(START, "model")
    graph.add_conditional_edges("model", tools_condition)
    graph.add_edge("tools", "model")
    return graph.compile(name=name)


# --- the top-level graph -------------------------------------------------------------


def merge(left: dict, right: dict) -> dict:
    return {**left, **right}


class State(TypedDict):
    task: str
    briefs: dict[str, str]
    findings: Annotated[dict[str, str], merge]  # parallel analysts write here
    synthesis: str
    feedback: str
    reviews: int
    answer: str


class Plan(BaseModel):
    benchmarks: str = Field(description="Brief for the benchmarks analyst, one sentence.")
    operations: str = Field(description="Brief for the operations analyst, one sentence.")
    ecosystem: str = Field(description="Brief for the ecosystem analyst, one sentence.")


ANALYSTS = {
    "benchmarks_analyst": (
        "benchmarks",
        [t.dataset_profile, t.run_benchmark],
        "You measure performance. Use your tools for all three databases. "
        "Reply with at most 4 short bullet points.",
    ),
    "operations_analyst": (
        "operations",
        [t.read_docs, t.hosting_cost],
        "You assess day-to-day operations and cost. Use your tools for all three databases. "
        "Reply with at most 4 short bullet points.",
    ),
    "ecosystem_analyst": (
        "ecosystem",
        [t.fetch_repo_stats, t.dashboard_integrations],
        "You assess project health and integrations. Use your tools for all three databases; "
        "if a tool fails, retry it. Reply with at most 4 short bullet points.",
    ),
}


def build_graph():  # type: ignore[no-untyped-def]
    llm = ChatAnthropic(model=model_name(), max_tokens=700)

    def supervisor(state: State) -> dict:
        plan = llm.with_structured_output(Plan).invoke([
            SystemMessage("You lead a small team of analysts. Split the task into one brief "
                          "per analyst: benchmarks, operations, ecosystem."),
            HumanMessage(state["task"]),
        ])
        return {"briefs": plan.model_dump()}  # type: ignore[union-attr]

    def analyst_node(name: str, brief_key: str, agent) -> callable:  # type: ignore[no-untyped-def]
        def run(state: State) -> dict:
            brief = f"{state['briefs'][brief_key]}\n\nTask context: {state['task']}"
            result = agent.invoke({"messages": [HumanMessage(brief)]})
            return {"findings": {name: str(result["messages"][-1].content)}}
        return run

    def synthesize(state: State) -> dict:
        notes = "\n\n".join(f"{k}:\n{v}" for k, v in state["findings"].items())
        prompt = [SystemMessage("Combine the analysts' findings into a short comparison "
                                "(max 120 words) with a tentative recommendation."),
                  HumanMessage(f"Task: {state['task']}\n\nFindings:\n{notes}")]
        if state.get("feedback"):
            prompt.append(HumanMessage(f"Revise it. Reviewer feedback: {state['feedback']}"))
        return {"synthesis": str(llm.invoke(prompt).content)}

    def critic(state: State) -> dict:
        reviews = state.get("reviews", 0) + 1
        if reviews == 1:
            feedback = llm.invoke([
                SystemMessage("You are a demanding reviewer. In one sentence, name the most "
                              "important thing this comparison should address better."),
                HumanMessage(state["synthesis"]),
            ]).content
            return {"reviews": reviews, "feedback": str(feedback)}
        return {"reviews": reviews, "feedback": ""}

    def after_critic(state: State) -> Literal["synthesize", "writer"]:
        return "synthesize" if state["feedback"] else "writer"

    writer_agent = build_agent(
        "writer",
        "You write the final answer for the user: first call format_table once with a "
        "comparison table (columns: Database, Speed, Operations, Ecosystem), then give the "
        "recommendation in at most 80 words, followed by the table.",
        [t.format_table],
        llm,
    )

    def writer(state: State) -> dict:
        result = writer_agent.invoke({"messages": [HumanMessage(
            f"Task: {state['task']}\n\nApproved comparison:\n{state['synthesis']}")]})
        return {"answer": str(result["messages"][-1].content)}

    graph = StateGraph(State)
    graph.add_node("supervisor", supervisor)
    for name, (brief_key, tools, instructions) in ANALYSTS.items():
        agent = build_agent(name, instructions, tools, llm)
        graph.add_node(name, analyst_node(name, brief_key, agent))
        graph.add_edge("supervisor", name)  # fan out: the three run in parallel
    graph.add_node("synthesize", synthesize)
    graph.add_node("critic", critic)
    graph.add_node("writer", writer)
    graph.add_edge(START, "supervisor")
    graph.add_edge(list(ANALYSTS), "synthesize")  # fan in: waits for all three
    graph.add_edge("synthesize", "critic")
    graph.add_conditional_edges("critic", after_critic)
    graph.add_edge("writer", END)
    return graph.compile(name="database_comparison")


def main() -> None:
    provider = setup_tracing("loopview-flagship-demo")
    LangChainInstrumentor().instrument(tracer_provider=provider)
    result = build_graph().invoke({"task": TASK, "findings": {}, "reviews": 0})
    print(result["answer"])
    provider.shutdown()


if __name__ == "__main__":
    main()
