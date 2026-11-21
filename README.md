# Emendas Pix: quanto cada município recebeu

Mapa interativo dos repasses de emendas Pix (transferências especiais, art. 166-A da Constituição) para os 5.570 municípios, com valor por habitante, ranking e os parlamentares que enviaram o dinheiro.

## Dados

- **Emendas:** [API de Transferências Especiais do Transferegov](https://api.transferegov.gestao.gov.br/transferenciasespeciais/). "Pago" é a soma dos documentos hábeis com ordem bancária enviada ao banco; "indicado" é o valor do plano de ação. O ano é o da emenda.
- **População:** IBGE, estimativa mais recente (SIDRA 6579).
- **Malha:** IBGE.

Repasses a governos estaduais aparecem só como nota quando um estado está filtrado.

## Rodar

```bash
npm install
npm run data   # baixa e processa os dados em public/data
npm run dev
```

## Autor

Feito por [Jorge Souza](https://www.linkedin.com/in/jorgejuniordeveloper/).
