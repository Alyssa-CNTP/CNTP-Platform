/**
 * Cleaning task definitions per section, with frequency.
 *
 * The capture UI is exception-based: tasks default to done; the operator only
 * flags what wasn't completed. Daily tasks show every shift; weekly/monthly
 * tasks carry a frequency tag (only-when-due scheduling builds on cleaning_records
 * history later). Operator identity + timestamps come from the login, so there
 * are no per-task name fields.
 */
export type Frequency = 'daily' | 'weekly' | 'monthly'

export interface CleaningTaskDef {
  key:         string      // stable id for the audit log (task_key)
  area:        string
  task:        string
  responsible: string
  frequency:   Frequency
}

const T = (key: string, area: string, task: string, responsible: string, frequency: Frequency = 'daily'): CleaningTaskDef =>
  ({ key, area, task, responsible, frequency })

export const CLEANING_TASKS: Record<string, CleaningTaskDef[]> = {
  sieving: [
    T('sv-1', 'Sieving', 'Vacuum walls and floor', 'Operator / General cleaner'),
    T('sv-2', 'Sieving', 'Brush sieves (every 2 hrs)', 'Operator'),
    T('sv-3', 'Sieving', 'Brush off aspirator', 'Operator'),
    T('sv-4', 'Sieving', 'Clean magnet', 'Operator'),
    T('sv-5', 'Sieving', 'Brush off dust on conveyors', 'Operator'),
    T('sv-6', 'Sieving', 'Brush down screen + vacuum dust', 'Operator'),
    T('sv-7', 'Sieving', 'Check and clean rotary valve', 'Operator'),
    T('db-1', 'De-bagging', 'Check and clean rotary valve', 'Operator'),
    T('db-2', 'De-bagging', 'Vacuum walls and floor', 'Operator / General cleaner'),
    T('db-3', 'De-bagging', 'Sweep spillages', 'General cleaner'),
    T('dc-1', 'Dust Collection Room', 'Brush crevices and hard-to-reach areas', 'General cleaner', 'weekly'),
    T('dc-2', 'Dust Collection Room', 'Vacuum walls and floors', 'General cleaner', 'weekly'),
    T('dc-3', 'Dust Collection Room', 'Change bag filters (Rooibos↔Honeybush)', 'General cleaner', 'monthly'),
  ],
  refining1: [
    T('db-1', 'De-bagging', 'Check and clean rotary valve', 'Operator'),
    T('db-2', 'De-bagging', 'Vacuum walls and floor', 'Operator / General cleaner'),
    T('db-3', 'De-bagging', 'Sweep spillages', 'General cleaner'),
    T('ps-1', 'Post-sieve', 'Clean sieves (brush off tea, dust, material)', 'Operator'),
    T('ps-2', 'Post-sieve', 'Remove foreign material from magnet + record', 'Operator'),
    T('ps-3', 'Post-sieve', 'Brush down screw conveyors and chute', 'Operator'),
    T('ps-4', 'Post-sieve', 'Vacuum walls and floors', 'Operator / General cleaner'),
    T('bg-1', 'Bagging', 'Wipe conveyor chute with disposable cloth', 'Bagging operator'),
    T('bg-2', 'Bagging', 'Brush down bagging machine', 'Bagging operator'),
    T('bg-3', 'Bagging', 'Vacuum internal walls and floor', 'General cleaner'),
    T('bg-4', 'Bagging', 'Lift scale and vacuum tea underneath', 'Bagging operator'),
  ],
  granule: [
    T('gl-1', 'Granule Line', 'Vacuum walls and floor', 'Operator / General cleaner'),
    T('gl-2', 'Granule Line', 'Brush off all dust on equipment', 'Operator'),
    T('gl-3', 'Granule Line', 'Check and clean rotary valve', 'Operator'),
    T('bg-1', 'Bagging', 'Wipe conveyor chute', 'Bagging operator'),
    T('bg-2', 'Bagging', 'Brush down bagging machine', 'Bagging operator'),
    T('bg-3', 'Bagging', 'Vacuum internal walls and floor', 'General cleaner'),
    T('bg-4', 'Bagging', 'Check and clean scale', 'Bagging operator'),
  ],
  blender: [
    T('bl-1', 'Blender', 'Vacuum walls and floor', 'Operator / General cleaner'),
    T('bl-2', 'Blender', 'After mini-blender: brush, vacuum, disinfect', 'Operator'),
    T('bg-1', 'Bagging', 'Wipe conveyor chute with disposable cloth', 'Bagging operator'),
    T('bg-2', 'Bagging', 'Brush down bagging machine', 'Bagging operator'),
    T('bg-3', 'Bagging', 'Vacuum internal walls and floor', 'General cleaner'),
    T('bg-4', 'Bagging', 'Check and clean scale', 'Bagging operator'),
  ],
  pasteuriser: [
    T('pr-1', 'Pasteuriser', 'Clean per PPM 13.4', 'Operator / General worker'),
    T('pr-2', 'Pasteuriser', 'Vacuum dust and leaves from walls and floors', 'Operator / General worker'),
    T('dr-1', 'Drying', 'Remove funnel at dryer feed + wipe', 'Operator / General worker'),
    T('dr-2', 'Drying', 'Remove hatches, brush + vacuum inside dryer', 'Operator / General worker', 'weekly'),
    T('dr-3', 'Drying', 'Brush down screw conveyor and chute', 'Operator / General worker'),
    T('dr-4', 'Drying', 'Vacuum walls and floors', 'Operator / General worker'),
    T('bg-1', 'Bagging', 'Wipe conveyor chute with disposable cloth', 'Bagging operator'),
    T('bg-2', 'Bagging', 'Brush down bagging machine', 'Bagging operator'),
    T('bg-3', 'Bagging', 'Vacuum internal walls and floor', 'General cleaner'),
    T('bg-4', 'Bagging', 'Check and clean scale', 'Bagging operator'),
  ],
  refining2: [],   // mirrors refining1
}
CLEANING_TASKS.refining2 = CLEANING_TASKS.refining1

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
}

export function cleaningTasksFor(sectionId: string): CleaningTaskDef[] {
  return CLEANING_TASKS[sectionId] ?? CLEANING_TASKS.refining1
}
