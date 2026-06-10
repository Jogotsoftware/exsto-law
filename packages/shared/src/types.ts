export type TenantId = string
export type ActorId = string
export type ActionId = string
export type EntityId = string
export type EntityKindId = string
export type AttributeKindId = string
export type WorkflowDefinitionId = string
export type ActionKindId = string

export type IntentKind =
  | 'correction'
  | 'reflection'
  | 'adjustment'
  | 'override'
  | 'exploration'
  | 'enforcement'
  | 'automatic_sync'
  | 'unknown'

export type AutonomyTier = 'autonomous' | 'notify' | 'approve' | 'suggest'

export type KnowabilityState =
  | 'observed'
  | 'observed_null'
  | 'never_observed'
  | 'withheld'
  | 'inapplicable'
  | 'pending'
  | 'stale'
  | 'computation_failed'

export type Confidence = number

export interface Hlc {
  physical_time: string
  logical_counter: number
  source_id: string
}
