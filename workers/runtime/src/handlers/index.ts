export {
  registerWorkerHandler,
  getWorkerHandler,
  clearWorkerHandlers,
  type WorkerHandler,
} from './registry.js'

// Register built-in handlers on import. Each handler module registers itself
// against the registry, which is defined in a separate module so this side-effect
// import cannot race the registry's initialization.
import './sample.js'
