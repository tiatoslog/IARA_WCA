import { notFound } from 'next/navigation';
import { PreviaPortaria } from './PreviaPortaria';

/**
 * A portaria, montada sozinha, para poder ser OLHADA.
 *
 * Sem Supabase configurado o app entra em modo local e vai direto para a sala:
 * `app/page.tsx` só monta a `Portaria` quando existe autenticação de verdade.
 * Ou seja, na máquina de quem desenha a tela, a tela de login é justamente a
 * única que nunca aparece. Esta rota resolve isso sem afrouxar nada — é a mesma
 * bancada de `/marca/forja`, e some em produção pelo mesmo motivo.
 *
 * Não é uma porta alternativa: entrar aqui não autentica ninguém. O formulário
 * continua falando com o Supabase, que sem chave devolve nulo e não submete.
 */
export default function Pagina() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <PreviaPortaria />;
}
