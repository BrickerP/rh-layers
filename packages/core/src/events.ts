import type { LayerEvent, LayerId } from './types';

export interface Recorder {
  emit: (layer: LayerId, kind: LayerEvent['kind'], msg: string, data?: Record<string, unknown>) => void;
  events: LayerEvent[];
}

export function createRecorder(startedAt = Date.now()): Recorder {
  const events: LayerEvent[] = [];
  return {
    events,
    emit(layer, kind, msg, data) {
      events.push({ t: Date.now() - startedAt, layer, kind, msg, data });
    },
  };
}
