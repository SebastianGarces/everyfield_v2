import { RegisterForm } from "./register-form";
import { isBetaGateEnabled } from "./beta-gate";

/**
 * Register page (server component).
 *
 * Resolves the private-beta gate flag server-side and hands ONLY a boolean to
 * the client form — the `BETA_INVITE_CODE` value never leaves the server.
 */
export default function RegisterPage() {
  const betaGateEnabled = isBetaGateEnabled();

  return <RegisterForm betaGateEnabled={betaGateEnabled} />;
}
