#!/usr/bin/env bash
# Regenera o painel e roda todos os test_*.js. Uso: bash run_tests.sh [padrão]
# Testes que dependem de planilhas reais fora do git imprimem "PULADO:" e aparecem separados no
# resumo — pulado NÃO é aprovado. Falhas mostram o código de saída (124 = estourou o tempo) e o
# log da falha é guardado com horário (não é sobrescrito pela próxima rodada).
set -uo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-/c/Users/acer1/AppData/Local/Programs/Python/Python312/python.exe}"
[[ -x "$PY" ]] || PY=python
PYTHONIOENCODING=utf-8 "$PY" build_painel.py >/dev/null || { echo "BUILD FALHOU"; exit 1; }
rm -rf __pycache__
LOGDIR="${TMPDIR:-/tmp}/apex_tests"; mkdir -p "$LOGDIR"
pass=0; fail=0; skip=0; falharam=""; pulados=""
for f in ${1:-test_*.js}; do
  [[ "$f" == "test_helper_mock.js" ]] && continue
  timeout 180 node "$f" > "$LOGDIR/$f.log" 2>&1
  code=$?
  if [[ $code -ne 0 ]]; then
    fail=$((fail+1)); falharam="$falharam $f(exit $code)"
    cp "$LOGDIR/$f.log" "$LOGDIR/$f.falhou-$(date +%H%M%S).log"
  elif grep -q "^PULADO:" "$LOGDIR/$f.log"; then
    skip=$((skip+1)); pulados="$pulados $f"
  else
    pass=$((pass+1))
  fi
done
echo "Logs em: $LOGDIR"
echo "Falharam:${falharam:- nenhum}"
[[ $skip -gt 0 ]] && echo "Pulados (sem fixture nesta máquina):$pulados"
echo "TOTAL: $pass passaram, $fail falharam, $skip pulados"
[[ $fail -eq 0 ]]
