/** The OTLP/HTTP traces endpoint that users point their exporter at. */
export function otlpEndpoint(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/v1/traces`
}
