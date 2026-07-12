'use client'

import type { TrainingQuestion, SubmittedAnswer } from '@/lib/training/training-config'
import { Check } from 'lucide-react'

interface Props {
  question: TrainingQuestion
  value:    SubmittedAnswer
  onChange: (value: SubmittedAnswer) => void
  index:    number
}

export function QuestionRunner({ question, value, onChange, index }: Props) {
  const options = question.options ?? []

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl p-4 space-y-3">
      <div className="flex items-start gap-2">
        <span className="font-mono text-[11px] text-stone-400 mt-0.5 shrink-0">{index + 1}.</span>
        <div className="flex-1">
          <p className="text-[13px] font-medium text-text">{question.prompt}</p>
          {question.image_url && (
            <img src={question.image_url} alt="" className="mt-2 rounded-xl border border-surface-rule max-w-full" />
          )}
          {question.manual_review && (
            <p className="text-[11px] text-warn mt-1">This answer is reviewed by the training officer — you'll see your provisional score now.</p>
          )}
        </div>
        <span className="font-mono text-[10px] text-stone-300 shrink-0">{question.points} pt{question.points === 1 ? '' : 's'}</span>
      </div>

      <div className="pl-5">
        {(question.kind === 'single_choice' || question.kind === 'true_false') && (
          <div className="space-y-1.5">
            {options.map(o => (
              <button key={o.id} type="button" onClick={() => onChange(o.id)}
                className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-xl border text-[13px] transition-colors ${
                  value === o.id ? 'border-brand bg-brand/8 text-brand font-medium' : 'border-stone-200 text-text hover:border-stone-300'
                }`}>
                <span className={`w-4 h-4 rounded-full border shrink-0 flex items-center justify-center ${value === o.id ? 'border-brand bg-brand' : 'border-stone-300'}`}>
                  {value === o.id && <Check size={10} className="text-white" />}
                </span>
                {o.label}
              </button>
            ))}
          </div>
        )}

        {question.kind === 'multi_choice' && (
          <div className="space-y-1.5">
            {options.map(o => {
              const selected = Array.isArray(value) && value.includes(o.id)
              return (
                <button key={o.id} type="button"
                  onClick={() => {
                    const arr = Array.isArray(value) ? [...value] : []
                    onChange(selected ? arr.filter(id => id !== o.id) : [...arr, o.id])
                  }}
                  className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-xl border text-[13px] transition-colors ${
                    selected ? 'border-brand bg-brand/8 text-brand font-medium' : 'border-stone-200 text-text hover:border-stone-300'
                  }`}>
                  <span className={`w-4 h-4 rounded shrink-0 flex items-center justify-center ${selected ? 'bg-brand border-brand' : 'border border-stone-300'}`}>
                    {selected && <Check size={10} className="text-white" />}
                  </span>
                  {o.label}
                </button>
              )
            })}
          </div>
        )}

        {question.kind === 'numeric' && (
          <input type="number" step="any" value={typeof value === 'number' || typeof value === 'string' ? value : ''}
            onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
            className="w-40 px-3 py-2 rounded-lg border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand"
            placeholder="Your answer" />
        )}

        {question.kind === 'short_text' && (
          <input type="text" value={typeof value === 'string' ? value : ''}
            onChange={e => onChange(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand"
            placeholder="Your answer" />
        )}

        {question.kind === 'matching' && (
          <div className="space-y-1.5">
            {options.map(o => {
              const map = (value && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, string> : {}
              return (
                <div key={o.id} className="flex items-center gap-2">
                  <span className="text-[13px] text-text flex-1">{o.label}</span>
                  <input type="text" value={map[o.id] ?? ''}
                    onChange={e => onChange({ ...map, [o.id]: e.target.value })}
                    className="w-40 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-[13px] text-text outline-none focus:border-brand"
                    placeholder="Match…" />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
