export const PERFIS: Record<string, Nivel> = { Administrador: "ADMIN", Colaborador: "ESCRITA", Leitura: "LEITURA" };
export type Nivel = "ADMIN" | "ESCRITA" | "LEITURA";

export const STATUS_IDEIA = ["Em Debate", "Em Redação", "Aprovada", "Arquivada"];
export const TIPOS_INTERACAO = ["Comentário", "Sugestão"];
export const STATUS_ENCAMINHAMENTO = ["Pendente", "Em Andamento", "Concluído", "Cancelado"];
export const STATUS_CITACAO = ["Pendente", "Encaminhada", "Resolvida"];
export const STATUS_ENTREGA = ["Aguardando análise", "Aprovado"];

// Pautas sem grupo (criadas antes dos GTs) pertencem a este grupo
export const GRUPO_PADRAO_ID = "GT-SISTEMAS";


export interface Sessao {
  apelido: string; // "" = observador; "admin" = administrador do primeiro acesso
  nome: string;
  nivel: Nivel;
}

// Só administradores excluem (sugestões, comentários, encaminhamentos, entregas, documentos e
// metadados), sempre com a senha; os demais perfis apenas incluem e editam
export const podeExcluirInteracoes = (sessao: Sessao) => sessao.nivel === "ADMIN";
