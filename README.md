## Controle de Despesas Pessoais 🧾💸

### Descrição 📝
O **Crontole de Despeesas Pessoais** é uma  um Aplicativo móvel, desenvolvido em **React Native** com **Expo** que permite ao  usuário registrar, categorizar e monitorar suas despesas de forma simples e eficiente. Ele interga-se com um **Bot do Telegram** e **Supabase**, oferecendo um sistema automatizado para registrar despesas a parti de mensagens enviadas em um Bot. Além disso, o app fornece uma visão clara sobre os gastos.


## Funcionalidades 🚀

- **📲 Cadastro Automático de Despesas:** Registre suas despesas automaticamente através de mensagens enviadas no Telegram.

- **💰 Controle de Caixinhas e Despesas:** Gerencie tanto caixinhas (para poupança/metas) quanto despesas diárias.

- **📊 Análise de Gastos Mensais:** Compare seus gastos diários, com análises sobre aumento ou redução percentual nas categorias. 

- **📈 Gráficos de Progresso:** Acompanhe visualmente seu progresso financeiro com gráficos.

## Tecnologias Utilizadas ⚙️

- **React Native:** Framework para desenvolvimento de aplicativos móveis.
- **Expo:** Plataforma que facilita o desenvolvimento e build de aplicativos React Native.
- **Supabase:** Banco de dados backend para armazenar despesas e caixinhas.
- **Telegram Bot API:** Integração para automatizar o registro de despesas via Telegram.
- **Axios:** Biblioteca para requisições HTTP à API do Telegram.
- **Chart.js / React Native Chart Kit:** Bibliotecas para exibir gráficos financeiros interativos.

## Instalação 💻

Siga os passos abaixo para rodar o projeto localmente:

### 1. Clone o repositório:  
``
git clone https://github.com/WesleyS08/DespesasApp
``
### 2. Instale as dependências:
``
npm install
``
### 3. Configure o arquivo ``.env``

Crie um arquivo ``.env ``na raiz do projeto e adicione as variáveis de ambiente necessárias:

`` 
TELEGRAM_TOKEN=seu-token-do-telegram
CHAT_ID=id-do-chat-do-telegram
SUPABASE_URL=url-do-supabase
SUPABASE_ANON_KEY=chave-anonima-do-supabase
``

### 4. Execute o projeto:
Se estiver usando o **Expo**, basta rodar:

`` 
npm start
``

Abra o aplicativo no seu dispositivo ou emulador usando o código QR exibido no navegador.

## Funcionalidades Extras 🎉

### 1. Mensagens Automatizadas no Telegram:

O app escuta o c
hat do Telegram, e ao receber uma mensagem com o formato adequado, os valores são analisados e registrados automaticamente. Configure categorias, valores e status diretamente no Telegram.

### 2. Análises e Comparações:

A aplicação gera análises detalhadas dos seus gastos mensais, comparando o gasto diário e destacando as variações (aumento ou diminuição).
### 3. Caixinhas de Dinheiro:

Gerencie caixinhas de dinheiro, como poupança ou metas financeiras. O app calcula automaticamente o saldo e a diferença de cada caixinha.


### Demonstração do App 
https://github.com/user-attachments/assets/fbbe6b7e-2591-453a-a960-e85ebd300f45
