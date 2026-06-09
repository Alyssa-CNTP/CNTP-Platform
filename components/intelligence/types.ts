export type Classification =
  | 'opportunity'
  | 'threat'
  | 'competitor'
  | 'regulation'
  | 'relationship'
  | 'neutral'

export interface Signal {
  id:              string
  created_at:      string
  source_type:     string
  source_url:      string | null
  source_domain:   string | null
  language:        string
  title:           string
  summary_en:      string | null
  classification:  Classification
  relevance_score: number
  sections:        string[]
  keyword_group:   string | null
  region:          string | null
  media_url:       string | null
  raw_content:     string | null
}
