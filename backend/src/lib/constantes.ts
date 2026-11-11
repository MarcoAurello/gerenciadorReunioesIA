export const PERFIS: Record<string, Nivel> = { Administrador: "ADMIN", Colaborador: "ESCRITA", Leitura: "LEITURA" };
export type Nivel = "ADMIN" | "ESCRITA" | "LEITURA";

export const STATUS_IDEIA = ["Em Debate", "Em Redação", "Aprovada", "Arquivada"];
export const TIPOS_INTERACAO = ["Comentário", "Sugestão"];
export const STATUS_ENCAMINHAMENTO = ["Pendente", "Em Andamento", "Concluído", "Cancelado"];
export const STATUS_CITACAO = ["Pendente", "Encaminhada", "Resolvida"];
export const STATUS_ENTREGA = ["Aguardando análise", "Aprovado"];

// Pautas sem grupo (criadas antes dos GTs) pertencem a este grupo
export const GRUPO_PADRAO_ID = "GT-SISTEMAS";

// Únicos usuários que podem excluir sugestões e comentários (sempre confirmando com a senha)
const EXCLUEM_INTERACOES = ["marco.nunes"];

export interface Sessao {
  apelido: string; // "" = observador; "admin" = administrador do primeiro acesso
  nome: string;
  nivel: Nivel;
}

export const podeExcluirInteracoes = (sessao: Sessao) =>
  EXCLUEM_INTERACOES.includes(String(sessao.apelido || "").toLowerCase());
