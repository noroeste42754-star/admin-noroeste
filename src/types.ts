// ─── Enums / Unions ────────────────────────────────────────────────────────

export type Role =
  | 'anciao'
  | 'servo-ministerial'
  | 'pioneiro'
  | 'batizado'
  | 'publicador'

export type Sex = 'M' | 'F'

export type ModuleName =
  | 'mestre'
  | 'tarefas'
  | 'limpeza'
  | 'escala'
  | 'oradores'
  | 'servicoCampo'
  | 'individual'

type TipoDesignacao =
  | 'presidente'
  | 'leitor'
  | 'microfone'
  | 'operador'
  | 'auditorio'
  | 'entrada'
  | 'limpeza-super'
  | 'limpeza-ajudante'
  | 'limpeza-grupo'
  | 'escala-campo'

// ─── Master ────────────────────────────────────────────────────────────────

interface MasterLimpeza {
  grupo: number | null
}

export interface MasterPessoa {
  name:     string
  whatsapp: string          // 13 dígitos: 55 + DDD + número
  sex:      Sex | null
  role:     Role | null
  active:   boolean
  limpeza:  MasterLimpeza
}

interface MasterMeta {
  schemaVersion: number
  createdAt:     string
  description:   string
}

// ─── Config ────────────────────────────────────────────────────────────────

export interface ConfigCongregacao {
  nome:     string
  cidade:   string
  circuito: string
  idioma:   string
}

interface ConfigReuniao {
  diaSemana: number   // 0-6: 0=domingo
  horario:   string   // 'HH:MM'
}

export interface ConfigReunioes {
  meiaDeSemana:  ConfigReuniao
  fimDeSemana:   ConfigReuniao
}

export interface ConfigLimpezaGrupo {
  nome?:              string
  superintendenteMid: string
  ajudantesMid:       string[]
}

export interface LimpezaSemanaGerada {
  manualGroup?: boolean
  referencia:          string
  dataMeioSemana:      string
  dataFimSemana:       string
  grupo:               number
  grupoNome:           string
  superintendenteMid:  string
  ajudantesMid:        string[]
  membrosMid:          string[]
}

export interface LimpezaPeriodoGerado {
  id:          string
  modo:        'month' | 'bimester'
  inicio:      string
  fim:         string
  geradoEm:    string
  congregacao: string
  semanas:     LimpezaSemanaGerada[]
  publicado?:  boolean
  publicadoEm?: string
}

export interface ConfigLimpeza {
  ativa:                 boolean
  periodMode?:           'month' | 'bimester'
  grupos:                number       // qtd de grupos
  inicioRotacao:         string       // 'YYYY-MM-DD'
  gruposConfig:          Record<string, ConfigLimpezaGrupo>
}

interface ConfigDesignacao {
  textoIcs:   string
  ativo:      boolean
  aprovadoEm: string   // 'YYYY-MM-DD' | ''
}

export interface MasterConfig {
  congregacao?:  ConfigCongregacao
  reunioes?:     ConfigReunioes
  limpeza?:      ConfigLimpeza
  designacoes?:  Partial<Record<TipoDesignacao, ConfigDesignacao>>
}

export type AgendaReminderModule =
  | 'tarefas'
  | 'oradores'
  | 'limpeza'
  | 'escala'
  | 'servicoCampo'
  | 'quadro'

export interface AgendaConfig {
  quadroWhatsAppLink?: string
  outrosAnunciosDriveUrl?: string
  moduleWhatsApp?: Partial<Record<AgendaReminderModule, {
    groupLink?: string
    meetingText?: string
    documentText?: string
  }>>
  icsReminders?: Partial<Record<AgendaReminderModule, string[]>>
}

type AgendaPublicDocumentModule =
  | 'tarefas'
  | 'oradores'
  | 'limpeza'
  | 'escala'
  | 'servicoCampo'
  | 'admin'

export interface AgendaPublicDocument {
  id: string
  modulo: AgendaPublicDocumentModule
  tipo?: 'modulo' | 'admin'
  periodo: string
  inicio?: string
  fim?: string
  origemPeriodoId?: string
  nome: string
  url: string
  storagePath?: string
  criadoEm: string
  sourceHash?: string
}


// ─── Usuários ──────────────────────────────────────────────────────────────

export interface AppPermissions {
  mestre:      boolean
  tarefas:     boolean
  limpeza?:    boolean
  escala:      boolean
  oradores?:   boolean
  servicoCampo?: boolean
  individual?: boolean
}

export interface Usuario {
  nome:             string
  senha:            string       // plain text por enquanto
  ativo:            boolean
  apps:             AppPermissions
  masterId?:        string       // campo legado da antiga Minha Agenda interna
}

// ─── Firebase raw snapshots ────────────────────────────────────────────────

export type RawPessoas   = Record<string, MasterPessoa>
export type RawUsuarios  = Record<string, Usuario>

interface RawMaster {
  meta?:   MasterMeta
  config?: MasterConfig
  pessoas: RawPessoas
}

export interface RawRoot {
  master?:      RawMaster
  usuarios?:    RawUsuarios
  tarefas?:     Record<string, unknown>
  limpeza?:     Record<string, unknown>
  escala?:      Record<string, unknown>
  oradores?:    Record<string, unknown>
  servicoCampo?: Record<string, unknown>
  agenda?:      Record<string, unknown>
}

// ─── App context ───────────────────────────────────────────────────────────

export interface AppContext {
  overview?: { month:string; pending:boolean }
  uid:     string
  usuario: Usuario
}
