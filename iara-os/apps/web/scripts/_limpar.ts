import {config} from 'dotenv'; config({path:'.env.local'}); config();
const {createClient}=await import('@supabase/supabase-js');
const bd=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ids=['prova-final','teste-degradado','auditoria-catalogo'];
const {data}=await bd.from('memoria_registros').select('id_usuario,texto').in('id_usuario',ids);
console.log('linhas de teste encontradas:', data?.length ?? 0);
for(const r of data??[]) console.log(' -', r.id_usuario, '|', String(r.texto).slice(0,40));
