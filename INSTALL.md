# 🔧 Instalação do Sistema de Combate

## Arquivos necessários
Coloque estes 2 arquivos **na mesma pasta** que o `main.js` e `index.html`:
- `combat.js`
- `combat-patch.js`

## Alteração no index.html (UMA linha)

Encontre esta linha no final do `index.html`:
```html
  <script type="module" src="./main.js"></script>
</body>
```

Adicione a linha do combat-patch **LOGO DEPOIS** do main.js:
```html
  <script type="module" src="./main.js"></script>
  <script type="module" src="./combat-patch.js"></script>
</body>
```

## NÃO precisa alterar mais nada
- NÃO precisa alterar o `main.js`
- NÃO precisa alterar o resto do `index.html`
- O `combat-patch.js` se conecta automaticamente ao Firebase e renderiza a aba Combate

## Como testar
1. Abra o site no navegador
2. Conecte na sala normalmente
3. Clique na aba ⚔️ Combate
4. **Abra o Console do navegador** (F12 → Console)
5. Você deve ver mensagens `[combat]` em azul:
   ```
   [combat] Container encontrado ✓
   [combat] ✅ Inicializado
   [combat]   db: OK
   [combat]   rid: 637
   [combat]   by: Ezenek
   [combat]   role: challenger
   ```
6. Se `db: NULL ⚠️` aparecer, o combat-patch criará seu próprio Firebase automaticamente

## Se o botão "Nova Batalha" não funcionar
Abra o Console (F12) e clique no botão. Você verá exatamente onde está o problema:
```
[CombatUI] 🔴 CLIQUE em Nova Batalha!
[CombatUI]   by = Ezenek
[CombatUI]   getDb() = ...
[CombatUI]   getRid() = 637
```

Se `getDb()` ou `getRid()` mostrarem `null`, o problema é a conexão Firebase.
Se nem aparecer a mensagem `🔴 CLIQUE`, o arquivo combat.js não está sendo carregado.
