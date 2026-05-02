# LottoMind Data

Repositório de dados do sistema LottoMind.
Atualizado automaticamente todo dia às 23h ET pelo GitHub Actions.

## Como funciona
1. O workflow `.github/workflows/update.yml` executa `fetch_results.py` todo dia
2. O script busca resultados das APIs oficiais gratuitas
3. Salva tudo em `results.json`
4. O LottoMind lê esse arquivo pela URL pública do GitHub

## URL pública dos dados
```
https://raw.githubusercontent.com/SEU_USUARIO/lottomind-data/main/results.json
```

## Fontes de dados
- **Powerball / Mega Millions**: NY Open Data (data.ny.gov) — gratuito, oficial
- **NY Take 5 / NY Lotto**: NY Open Data — gratuito, oficial  
- **Lotto America**: powerball.com API pública
- **Millionaire for Life**: NY Open Data
- **Demais jogos**: dados iniciais verificados manualmente
