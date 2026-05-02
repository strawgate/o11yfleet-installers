------------------------------ MODULE pending ------------------------------
(***************************************************************************)
(* TLA+ specification of the pending-collector lifecycle in o11yfleet.     *)
(*                                                                         *)
(* Models the *target* architecture (post Phase 6 of the cleanup tracked   *)
(* in PR #426 and the work that subsumes #422). The split this spec        *)
(* assumes:                                                                *)
(*                                                                         *)
(*   - The Worker is a stateless gateway (HMAC verify + edge rate limit +  *)
(*     route by `idFromName`).                                             *)
(*   - The Pending DO holds all pending state and enforces all policy.    *)
(*   - Decisions (decideOnConnect / decideOnFirstMessage / decideOnAssign) *)
(*     are pure functions of the DO's current state plus an event.        *)
(*                                                                         *)
(* The spec exists to model-check safety and liveness *across all          *)
(* interleavings* of operator actions and agent actions. Tests cover       *)
(* individual interleavings; this covers the combinatorial space.          *)
(***************************************************************************)

EXTENDS Naturals, FiniteSets, Sequences, TLC

CONSTANTS
  Tenants,        \* Set of tenant ids                e.g. {"t1","t2"}
  Configs,        \* Set of config ids                e.g. {"c1","c2"}
  Tokens,         \* Set of token ids                 e.g. {"tok1","tok2"}
  Devices,        \* Set of device (instance) ids     e.g. {"d1","d2"}
  TokenTenant,    \* Tokens -> Tenants  (each token is owned by a tenant)
  TokenScope      \* Tokens -> Configs ∪ {NoScope}  (optional config scope)

NoScope == "no_scope"

ASSUME
  /\ TokenTenant \in [Tokens -> Tenants]
  /\ TokenScope  \in [Tokens -> Configs \cup {NoScope}]

(***************************************************************************)
(* State variables                                                         *)
(***************************************************************************)

VARIABLES
  tokens,           \* {tok ∈ Tokens : status ∈ {"active","revoked"}}
  devices,          \* device id -> {tenant_id, target_config_id, status}
  assignments,      \* device id -> target config_id (operator decision)
  claims,           \* set of (device_id, config_id) — claims delivered to agents
  agentTokens,      \* device id -> token id used to connect (if any)
  events            \* monotonic counter for liveness checks

vars == <<tokens, devices, assignments, claims, agentTokens, events>>

(***************************************************************************)
(* Initial state — operator has issued some tokens, nothing else exists   *)
(***************************************************************************)

Init ==
  /\ tokens = [t \in Tokens |-> "active"]
  /\ devices = <<>>           \* SQL: empty pending_devices
  /\ assignments = <<>>       \* SQL: empty pending_assignments
  /\ claims = {}              \* No claims issued
  /\ agentTokens = <<>>       \* No agents connected
  /\ events = 0

(***************************************************************************)
(* Helper: domain of a function-as-record                                  *)
(***************************************************************************)

DomainOf(f) == { k \in DOMAIN f : TRUE }

(***************************************************************************)
(* Action: agent connects with a token (worker has verified HMAC + rate   *)
(* limited; we model the post-rate-limit step). DO independently checks    *)
(* token status; revoked or unknown tokens fail closed.                    *)
(***************************************************************************)

Connect(d, t) ==
  /\ d \in Devices
  /\ t \in Tokens
  /\ d \notin DOMAIN devices                  \* device not yet registered
  /\ tokens[t] = "active"                      \* DO's own revocation check
  /\ devices' = devices @@ (d :> [
       tenant_id        |-> TokenTenant[t],
       target_config_id |-> TokenScope[t],     \* may be NoScope
       status           |-> "pending"
     ])
  /\ agentTokens' = agentTokens @@ (d :> t)
  /\ events' = events + 1
  /\ UNCHANGED <<tokens, assignments, claims>>

(***************************************************************************)
(* Action: operator assigns a pending device to a configuration. Honors   *)
(* the token's scope: an assignment to a config different from the token's *)
(* scope (if any) must be rejected. This is the decideOnAssign rule.       *)
(***************************************************************************)

CanAssign(d, c) ==
  /\ d \in DOMAIN devices
  /\ c \in Configs
  /\ devices[d].status = "pending"
  /\ \/ devices[d].target_config_id = NoScope         \* unscoped token
     \/ devices[d].target_config_id = c               \* scope matches

Assign(d, c) ==
  /\ CanAssign(d, c)
  /\ assignments' = (IF d \in DOMAIN assignments
                     THEN [a \in DOMAIN assignments |-> IF a = d THEN c ELSE assignments[a]]
                     ELSE assignments @@ (d :> c))
  /\ events' = events + 1
  /\ UNCHANGED <<tokens, devices, claims, agentTokens>>

(***************************************************************************)
(* Action: agent reconnects (or first frame after connect) — DO sees an   *)
(* assignment for this device and issues a claim. This consumes the        *)
(* assignment.                                                             *)
(***************************************************************************)

ConsumeAssignment(d) ==
  /\ d \in DOMAIN assignments
  /\ d \in DOMAIN devices
  /\ devices[d].status = "pending"
  /\ LET c == assignments[d] IN
     /\ claims' = claims \cup {<<d, c>>}
     /\ devices' = [devices EXCEPT ![d].status = "claimed"]
  /\ assignments' = [a \in DOMAIN assignments \ {d} |-> assignments[a]]
  /\ events' = events + 1
  /\ UNCHANGED <<tokens, agentTokens>>

(***************************************************************************)
(* Action: operator revokes a token.                                      *)
(***************************************************************************)

Revoke(t) ==
  /\ t \in Tokens
  /\ tokens[t] = "active"
  /\ tokens' = [tokens EXCEPT ![t] = "revoked"]
  /\ events' = events + 1
  /\ UNCHANGED <<devices, assignments, claims, agentTokens>>

(***************************************************************************)
(* Next state                                                              *)
(***************************************************************************)

Next ==
  \/ \E d \in Devices, t \in Tokens : Connect(d, t)
  \/ \E d \in Devices, c \in Configs : Assign(d, c)
  \/ \E d \in Devices : ConsumeAssignment(d)
  \/ \E t \in Tokens : Revoke(t)

(***************************************************************************)
(* Fairness: an assigned device that's connected eventually consumes its   *)
(* assignment (modeling the live-push or first-frame promotion).           *)
(***************************************************************************)

Spec ==
  /\ Init
  /\ [][Next]_vars
  /\ \A d \in Devices : WF_vars(ConsumeAssignment(d))

(***************************************************************************)
(* Type invariant — sanity check on the state space                       *)
(***************************************************************************)

TypeOK ==
  /\ tokens \in [Tokens -> {"active", "revoked"}]
  /\ \A d \in DOMAIN devices :
       /\ devices[d].tenant_id \in Tenants
       /\ devices[d].target_config_id \in Configs \cup {NoScope}
       /\ devices[d].status \in {"pending", "claimed"}
  /\ \A d \in DOMAIN assignments : assignments[d] \in Configs
  /\ claims \subseteq (Devices \X Configs)

(***************************************************************************)
(* SAFETY: a claim's config_id always agrees with the connecting token's   *)
(* scope. This is decideOnAssign's whole job — model-checking it across    *)
(* all interleavings catches any race that would hand a scoped collector  *)
(* a claim for the wrong config.                                           *)
(***************************************************************************)

ClaimsRespectScope ==
  \A claim \in claims :
    LET d == claim[1]
        c == claim[2]
    IN  d \in DOMAIN devices
        => \/ devices[d].target_config_id = NoScope
           \/ devices[d].target_config_id = c

(***************************************************************************)
(* SAFETY: every claimed device has a recorded connection — i.e., we       *)
(* never invent a claim for a device that didn't come in on a token. If    *)
(* this fails, an action somewhere wrote into `claims` without going       *)
(* through `Connect`, which would let the system manufacture identities.  *)
(*                                                                          *)
(* (Earlier draft of this property had a `=> TRUE` clause that made it    *)
(* trivially satisfied — caught by CodeRabbit review on PR #426.)         *)
(***************************************************************************)

EveryClaimedDeviceWasConnected ==
  \A claim \in claims :
    claim[1] \in DOMAIN agentTokens

(***************************************************************************)
(* SAFETY: pending_devices and pending_assignments stay in the expected    *)
(* relationship — assignments only exist for known pending devices.       *)
(***************************************************************************)

AssignmentsReferenceDevices ==
  \A d \in DOMAIN assignments : d \in DOMAIN devices

(***************************************************************************)
(* SAFETY: a claim is issued at most once per (device, config) tuple.     *)
(* Tied to the pending_assignments row being consumed (cleared) on issue.  *)
(***************************************************************************)

NoDuplicateClaim ==
  \A d \in Devices :
    Cardinality({claim \in claims : claim[1] = d}) <= 1

(***************************************************************************)
(* LIVENESS: every assignment eventually becomes a claim, given fair       *)
(* scheduling of ConsumeAssignment. This is the property that the          *)
(* live-push + reconnect promotion together guarantee.                     *)
(***************************************************************************)

EveryAssignmentEventuallyClaimed ==
  \A d \in Devices :
    (d \in DOMAIN assignments) ~> (\E claim \in claims : claim[1] = d)

(***************************************************************************)
(* Properties bundled for the model check.                                 *)
(***************************************************************************)

SafetyInvariants ==
  /\ TypeOK
  /\ ClaimsRespectScope
  /\ AssignmentsReferenceDevices
  /\ NoDuplicateClaim

LivenessProperties ==
  EveryAssignmentEventuallyClaimed

=============================================================================
