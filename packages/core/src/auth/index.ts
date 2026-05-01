// Auth placeholder — will be implemented in Phase 1D
export { signClaim, verifyClaim } from "./claims.js";
export {
  generateEnrollmentToken,
  hashEnrollmentToken,
  verifyEnrollmentToken,
} from "./enrollment.js";
export { base64urlEncode, base64urlDecode } from "./base64url.js";
export { timingSafeEqual } from "./timing-safe-compare.js";
export type { AssignmentClaim } from "./claims.js";
