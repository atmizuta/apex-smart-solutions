// Gera demo_local.html: o painel com o Supabase falso (demo_supabase.js) injetado antes do script
// principal. Só local — ignorado no git e fora do public_html/ (o deploy.sh nunca envia).
// Uso: node demo_local.js   (depois de python build_painel.py)
const fs = require('fs');
const painel = fs.readFileSync('painel_clientes_apex.html', 'utf8');
const fake = fs.readFileSync('demo_supabase.js', 'utf8');
const i = painel.indexOf('<script>'); // primeiro <script> sem src = script principal (a string '<script>' também aparece dentro dele)
if(i < 0) throw new Error('script principal não encontrado');
const banner = '<div style="position:fixed;left:50%;top:0;transform:translateX(-50%);z-index:999;background:#1D1F20;color:#fff;font:600 12px Barlow,sans-serif;padding:4px 14px;letter-spacing:.1em;text-transform:uppercase">Demonstração local · dados fictícios</div>';
const out = painel.slice(0, i) + '<script>\n' + fake + '\n</script>\n' + banner + '\n' + painel.slice(i);
fs.writeFileSync('demo_local.html', out);
console.log('OK — demo_local.html gerado (' + out.length + ' bytes)');
