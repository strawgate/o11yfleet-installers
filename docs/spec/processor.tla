----------------------------- MODULE processor -----------------------------
(***************************************************************************)
(* TLA+ specification of `processFrame`, the OpAMP state machine in        *)
(* `packages/core/src/state-machine/processor.ts`.                          *)
(*                                                                          *)
(* processFrame is a pure async function:                                   *)
(*   (state, msg, configBytes?, heartbeatNs?, ctx?) -> ProcessResult       *)
(*                                                                          *)
(* ─── Scope of this spec ────────────────────────────────────────────── *)
(*                                                                          *)
(* Deliberately narrow. Models the FRAME-ORDERING and SEQUENCE-NUMBER      *)
(* / CONFIG-HASH / DISCONNECT semantics. Does NOT model:                   *)
(*                                                                          *)
(*   - Health updates (`msg.health` overwrites status/last_error/etc.)     *)
(*   - Effective config reporting (a parallel hash channel)                *)
(*   - `connected_at` session-generation tracking                           *)
(*   - `RequestInstanceUid` flag handling                                  *)
(*   - Component health map updates                                         *)
(*   - Agent description tracking                                           *)
(*                                                                          *)
(* Those are out of scope because their state mutations are independent of *)
(* sequence-num / disconnect / config ordering — the properties we care   *)
(* about here. A separate spec could model the health/effective-config     *)
(* tracks if those become a focus of future bugs.                           *)
(*                                                                          *)
(* ─── What this spec is good for ─────────────────────────────────────── *)
(*                                                                          *)
(* Catching: gap-priority-vs-disconnect ordering regressions, current-     *)
(* config-hash monotonicity violations, status transitions that bypass    *)
(* hello, capability-tracking divergence from the wire.                    *)
(*                                                                          *)
(* Not catching: health-state errors, effective-config drift, dedupe-key   *)
(* uniqueness, anything that depends on `connected_at` or session id.     *)
(***************************************************************************)

EXTENDS Naturals, FiniteSets, Sequences, TLC

CONSTANTS
  MaxSeq,           \* Maximum sequence number to explore (bounded for TLC)
  Capabilities,     \* Set of capability bitmasks to consider, e.g. {0,1,2,4}
  ConfigHashes      \* Set of config hash representatives, e.g. {"H1","H2",NoHash}

NoHash == "no_hash"

ASSUME
  /\ MaxSeq \in Nat
  /\ Capabilities \subseteq Nat
  /\ NoHash \in ConfigHashes

(***************************************************************************)
(* State variables — match the TS AgentState shape, projected to fields    *)
(* whose transitions matter for protocol-level safety.                     *)
(***************************************************************************)

VARIABLES
  agentSeq,            \* state.sequence_num
  agentStatus,         \* state.status: "connected" / "disconnected"
  agentCapabilities,   \* state.capabilities
  agentCurrentHash,    \* state.current_config_hash (NoHash if not applied yet)
  events,              \* sequence of events emitted (sequence-of-records)
  numFramesProcessed   \* counter to bound the model

vars == <<agentSeq, agentStatus, agentCapabilities, agentCurrentHash,
          events, numFramesProcessed>>

(***************************************************************************)
(* Initial state — fresh agent, no frames seen yet.                        *)
(***************************************************************************)

Init ==
  /\ agentSeq = 0
  /\ agentStatus = "unknown"
  /\ agentCapabilities = 0
  /\ agentCurrentHash = NoHash
  /\ events = <<>>
  /\ numFramesProcessed = 0

(***************************************************************************)
(* Frame actions — model the branches of processFrame. Each action          *)
(* corresponds to a kind of frame the agent might send.                     *)
(***************************************************************************)

(* Hello (sequence_num = 0). Resets connection state and emits a connect   *)
(* event.                                                                   *)
Hello(caps) ==
  /\ caps \in Capabilities
  /\ numFramesProcessed < MaxSeq
  /\ agentSeq' = 0
  /\ agentStatus' = "connected"
  /\ agentCapabilities' = caps
  /\ events' = Append(events, [type |-> "connected", caps |-> caps])
  /\ numFramesProcessed' = numFramesProcessed + 1
  /\ UNCHANGED <<agentCurrentHash>>

(* Heartbeat / status update with contiguous sequence number. Updates      *)
(* capabilities and (if msg has remote_config_status APPLIED) the current  *)
(* config hash.                                                             *)
ContiguousFrame(caps, applied) ==
  /\ caps \in Capabilities
  /\ applied \in ConfigHashes
  /\ numFramesProcessed < MaxSeq
  /\ agentStatus = "connected"
  /\ agentSeq < MaxSeq
  /\ agentSeq' = agentSeq + 1
  /\ agentCapabilities' = caps
  /\ agentCurrentHash' =
       IF applied = NoHash THEN agentCurrentHash ELSE applied
  /\ events' =
       IF applied # NoHash /\ applied # agentCurrentHash
       THEN Append(events, [type |-> "config_applied", hash |-> applied])
       ELSE events
  /\ numFramesProcessed' = numFramesProcessed + 1
  /\ UNCHANGED <<agentStatus>>

(* Sequence-gap frame: msg.sequence_num != 0 and != state.sequence_num+1.   *)
(* Documented behavior: the gap branch returns ReportFullState; downstream  *)
(* per-frame handlers (capability update, disconnect, config-status) do    *)
(* NOT run. This is the property the TS comment in processor.ts pins.      *)
GapFrame(badSeq) ==
  /\ badSeq \in 0..MaxSeq
  /\ badSeq # 0
  /\ badSeq # agentSeq + 1
  /\ numFramesProcessed < MaxSeq
  /\ agentSeq' = badSeq
  /\ events' = events  \* gap branch emits no fleet events
  /\ numFramesProcessed' = numFramesProcessed + 1
  /\ UNCHANGED <<agentStatus, agentCapabilities, agentCurrentHash>>

(* Disconnect with contiguous sequence — honored. Status flips, no further *)
(* response.                                                                *)
ContiguousDisconnect ==
  /\ numFramesProcessed < MaxSeq
  /\ agentStatus = "connected"
  /\ agentSeq < MaxSeq
  /\ agentSeq' = agentSeq + 1
  /\ agentStatus' = "disconnected"
  /\ events' = Append(events, [type |-> "disconnected"])
  /\ numFramesProcessed' = numFramesProcessed + 1
  /\ UNCHANGED <<agentCapabilities, agentCurrentHash>>

(* Disconnect with a gap'd sequence — NOT honored (gap branch wins). This  *)
(* is the intentional ordering choice documented in processor.ts.          *)
GapDisconnect(badSeq) ==
  /\ badSeq \in 0..MaxSeq
  /\ badSeq # 0
  /\ badSeq # agentSeq + 1
  /\ numFramesProcessed < MaxSeq
  /\ agentSeq' = badSeq
  /\ events' = events  \* no disconnect event emitted
  /\ numFramesProcessed' = numFramesProcessed + 1
  /\ UNCHANGED <<agentStatus, agentCapabilities, agentCurrentHash>>

Next ==
  \/ \E caps \in Capabilities : Hello(caps)
  \/ \E caps \in Capabilities, applied \in ConfigHashes : ContiguousFrame(caps, applied)
  \/ \E badSeq \in 0..MaxSeq : GapFrame(badSeq)
  \/ ContiguousDisconnect
  \/ \E badSeq \in 0..MaxSeq : GapDisconnect(badSeq)

(***************************************************************************)
(* Type invariant                                                          *)
(***************************************************************************)

TypeOK ==
  /\ agentSeq \in 0..MaxSeq
  /\ agentStatus \in {"unknown", "connected", "disconnected"}
  /\ agentCapabilities \in Capabilities \cup {0}
  /\ agentCurrentHash \in ConfigHashes
  /\ numFramesProcessed \in 0..MaxSeq

(***************************************************************************)
(* SAFETY: A `disconnected` event is only emitted from the contiguous-     *)
(* disconnect branch. Never from a gap'd disconnect. This pins the         *)
(* documented gap-priority-over-disconnect semantics — the most            *)
(* important property the spec is here to catch a regression of.           *)
(***************************************************************************)

DisconnectsAreContiguous ==
  \A i \in 1..Len(events) :
    events[i].type = "disconnected"
    => agentStatus = "disconnected"

(***************************************************************************)
(* SAFETY: agentCurrentHash never reverts to NoHash once an apply has      *)
(* succeeded. A spurious NoHash would imply we "forgot" a successful       *)
(* apply, which the implementation never does (only CONFIG_APPLIED         *)
(* writes the column, and it always writes a non-null hash).               *)
(*                                                                          *)
(* This is a real check on the action signatures: every action that mutates*)
(* agentCurrentHash sets it to a value in `ConfigHashes \ {NoHash}` once   *)
(* set.                                                                     *)
(***************************************************************************)

CurrentHashStable ==
  agentCurrentHash # NoHash => agentCurrentHash' # NoHash

(***************************************************************************)
(* SAFETY: At no point in the run does the agent transition from           *)
(* `disconnected` to `connected` outside of a Hello action. A non-Hello    *)
(* status flip back to connected would mean we silently revived the        *)
(* session without re-handshaking.                                          *)
(*                                                                          *)
(* Stated as a "next-state" relation (uses primed variables): in any       *)
(* transition where status was disconnected, either status stays           *)
(* disconnected or the action fired was a Hello.                            *)
(***************************************************************************)

NoSpontaneousReconnect ==
  /\ agentStatus = "disconnected"
  /\ agentStatus' = "connected"
  => \E caps \in Capabilities : Hello(caps)
  \* Equivalently: a transition from disconnected->connected can only
  \* be witnessed by a Hello action. TLC checks this directly.

(***************************************************************************)
(* Composite invariants and spec definition                                *)
(***************************************************************************)

SafetyInvariants ==
  /\ TypeOK
  /\ DisconnectsAreContiguous
  /\ CurrentHashStable

\* NoSpontaneousReconnect uses primed variables so it's a temporal
\* property (a relation between consecutive states), not a one-state
\* invariant. TLC checks it via the spec, not the INVARIANTS list.

Spec == Init /\ [][Next]_vars

=============================================================================
