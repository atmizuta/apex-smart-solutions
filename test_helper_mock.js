// Helpers compartilhados pelos testes (25/09/2026).
const fs = require('fs');

// comRange: fetchAllRows() (25/09/2026) pagina toda consulta de tabela inteira com
// .range(from, to). Os mocks antigos do Supabase não têm .range() — este wrapper adiciona,
// fatiando o resultado que o builder original já resolveria. Não mexe em builders que já têm range.
function comRange(createClient){
  return function(...args){
    const client = createClient(...args);
    const fromOriginal = client.from.bind(client);
    client.from = (tabela) => comRangeNoBuilder(fromOriginal(tabela));
    return client;
  };
}

function comRangeNoBuilder(builder){
  if(!builder || typeof builder !== 'object' || typeof builder.range === 'function') return builder;
  const proxy = new Proxy(builder, {
    get(alvo, prop){
      if(prop === 'range'){
        return (de, ate) => ({
          then(resolve, reject){
            return Promise.resolve(alvo).then(r => {
              if(r && !r.error && Array.isArray(r.data)) return resolve({ ...r, data: r.data.slice(de, ate + 1) });
              return resolve(r);
            }, reject);
          },
        });
      }
      const valor = alvo[prop];
      if(typeof valor !== 'function') return valor;
      if(prop === 'then') return valor.bind(alvo);
      return (...a) => {
        const saida = valor.apply(alvo, a);
        if(saida === alvo) return proxy;
        return (saida && typeof saida === 'object' && typeof saida.then === 'function') ? comRangeNoBuilder(saida) : saida;
      };
    },
  });
  return proxy;
}

// exigirArquivo: alguns testes usam planilhas reais que não vão pro git (dados de cliente).
// Sem o arquivo, o teste é PULADO com aviso (exit 0) em vez de falhar.
function exigirArquivo(caminho, nomeDoTeste){
  if(fs.existsSync(caminho)) return true;
  console.log(`PULADO: ${nomeDoTeste} — fixture "${caminho}" não está nesta máquina (fica fora do git por conter dados reais).`);
  return false;
}

module.exports = { comRange, exigirArquivo };
