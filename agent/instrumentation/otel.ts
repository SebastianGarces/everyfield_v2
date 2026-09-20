import { otel } from "eve/instrumentation/otel";

export default otel({
  tracePolicy: () => ({
    emit: true,
    recordInputs: false,
    recordOutputs: false,
  }),
});
