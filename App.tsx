import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, FlatList, RefreshControl, TouchableOpacity, ScrollView } from 'react-native';
import axios from 'axios';
import { Picker } from '@react-native-picker/picker';
import { createClient } from '@supabase/supabase-js';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {

  ProgressChart,

} from "react-native-chart-kit";
import { Dimensions } from "react-native";

// Importe as variáveis de ambiente
import { TELEGRAM_TOKEN, CHAT_ID, SUPABASE_URL, SUPABASE_KEY } from '@env';

// Criação do cliente Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

type Message = {
  id: number;
  text: string;
  expense?: string;
  value?: number;
  status?: string;
  category?: string;
  box?: boolean;
  operation?: 'mais' | 'menos';
};


export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [monthlyTotal, setMonthlyTotal] = useState<number>(0);
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [totalsByCategory, setTotalsByCategory] = useState<{ [key: string]: number }>({});
  const [filterExpense, setFilterExpense] = useState('');
  const [numToRender, setNumToRender] = useState(10)
  const [comparisonData, setComparisonData] = useState({});
  const [maxIncrease, setMaxIncrease] = useState(null);
  const [maxDecrease, setMaxDecrease] = useState(null);
  const [comparisonResults, setComparisonResults] = useState([]);
  const parseMessageDetails = (message: string): {
    expense?: string;
    value?: number;
    status?: string;
    category?: string;
    box?: boolean;
    operation?: 'mais' | 'menos'
  } | null => {
    console.log('Analisando mensagem:', message); // Log para ver a mensagem original

    if (message.toLowerCase().includes('deletar')) {
      console.log('Mensagem ignorada (deletar detectado).');
      return null;  // Ignora a mensagem
    }

    // Verificar se é uma "caixinha" com o hífen
    const caixaRegex = /Caixinha:\s*([a-zA-Záàãâéèêíóòôúç\s]+)\s*-\s*(mais|menos)\s*(\d+(\.\d+)?)/i;
    const caixaMatch = message.match(caixaRegex);

    if (caixaMatch) {
      console.log('Mensagem de caixinha encontrada:', caixaMatch); // Log para ver os detalhes da caixinha
      return {
        box: true,  // Marcando como caixinha
        expense: caixaMatch[1].trim(),  // Nome da caixinha
        value: parseFloat(caixaMatch[3]),  // Valor da caixinha
        operation: caixaMatch[2] as 'mais' | 'menos',  // Operação de "mais" ou "menos"
        category: caixaMatch[1].trim(),  // Preencher a categoria com o nome da caixinha
      };
    }

    // Caso contrário, analisar como uma despesa
    const regex = /([a-zA-Z\s]+)\s*-\s*(\d+)\s*-\s*(Pago|Não\sPago)/i;
    const match = message.match(regex);

    if (match) {
      console.log('Mensagem de despesa encontrada:', match); // Log para ver os detalhes da despesa
      return {
        expense: match[1].trim(),
        value: parseFloat(match[2]),
        status: match[3] === 'Pago' ? 'Pago' : 'Não Pago',
        category: message.includes('Categoria:') ? message.split('Categoria:')[1].trim() : 'Desconhecido',
      };
    }

    console.log('Mensagem não corresponde a nenhum padrão (caixinha ou despesa).');
    return null;
  };

  const formatDateToDay = (timestamp) => {
    const date = new Date(timestamp * 1000); // Converter para milissegundos
    return date.toISOString().split('T')[0]; // Retorna apenas a parte da data 'YYYY-MM-DD'
  };
  


  const fetchMessages = async () => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0); // Começo do dia (meia-noite)
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999); // Fim do dia (23:59:59.999)
  
      const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`;
      console.log(url);
      const response = await axios.get(url);
      const updates = response.data.result;
  
      const allMessages = updates
        .map((update) => {
          const message = update.message || update.edited_message;
          const messageDate = new Date(message?.date * 1000); // Garantir que é um objeto Date
  
          if (message?.chat?.id === parseInt(CHAT_ID)) {
            const messageDetails = parseMessageDetails(message.text || '');
  
            if (!messageDetails) {
              markMessageAsDeleted(message.message_id);
              return null;
            }
  
            const expenseColor = generateColorForExpense(messageDetails.expense);
  
            return {
              id: message.message_id,
              text: message.text || 'Mensagem sem texto',
              expense: messageDetails.expense,
              value: messageDetails.value,
              status: messageDetails.status,
              category: messageDetails.category,
              color: expenseColor,
              box: messageDetails.box,
              operation: messageDetails.operation,
              created_at: messageDate, // Armazenar a data de criação
            };
          }
          return null;
        })
        .filter(Boolean); // Remove itens nulos ou inválidos
  
      // Ordenar as mensagens das mais novas para as mais antigas
      const sortedMessages = allMessages.sort((a, b) => b.created_at - a.created_at); // As mais novas primeiro
  
      // Agrupar mensagens por dia
      const groupedMessages = groupMessagesByDay(sortedMessages);
  
      // Calcular os totais diários
      const dailyTotals = calculateDailyTotals(groupedMessages);
  
      // Calcular as diferenças entre os dias
      const comparisonResults = calculateDifferences(dailyTotals);
  
      console.log('Comparação entre os dias:', comparisonResults);
  
      // Exibir os resultados
      setMessages(Object.values(groupedMessages)); // Atualiza a lista de mensagens agrupadas por dia
      setComparisonResults(comparisonResults); // Atualiza os resultados da comparação
  
      // Seguir com o processo de salvar caixinhas ou despesas...
      const caixinhas = allMessages.filter((msg) => msg.box);
      const despesas = allMessages.filter((msg) => !msg.box);
  
      if (caixinhas.length > 0) {
        await saveCaixinhasToSupabase(caixinhas);
      }
  
      if (despesas.length > 0) {
        await saveExpensesToSupabase(despesas);
      }
    } catch (error) {
      console.error('Erro ao buscar mensagens:', error);
    }
  };
  

  

  const saveCaixinhasToSupabase = async (messages: Message[]) => {
    try {
      for (const message of messages) {
        // Verifica se a mensagem já existe no banco
        const { data, error } = await supabase
          .from('caixinhas')
          .select('message_id, created_at')
          .eq('message_id', message.id)
          .single(); // Espera no máximo um registro
  
        if (error && error.code !== 'PGRST116') { // Código de erro que indica que o item não foi encontrado
          console.error('Erro ao buscar a mensagem no banco de dados:', error);
          return;
        }
  
        if (data) {
          // Se a mensagem já existir, vamos atualizá-la sem alterar o `created_at`
          await supabase
            .from('caixinhas')
            .update({
              expense: message.expense,
              value: message.value,
              operation: message.operation,
              category: message.category,
              box: true,
              is_deleted: false,
            })
            .eq('message_id', message.id); // Atualiza somente os campos necessários
        } else {
          // Se a mensagem não existir, vamos inseri-la com `created_at` do momento da inserção
          await supabase
            .from('caixinhas')
            .insert([{
              message_id: message.id,
              expense: message.expense,
              value: message.value,
              operation: message.operation,
              category: message.category,
              box: true,
              is_deleted: false,
              created_at: message.created_at, // A data original será salva aqui
            }]);
        }
      }
  
      console.log('Mensagens de caixinhas processadas corretamente');
    } catch (error) {
      console.error('Erro ao salvar ou atualizar caixinhas no Supabase:', error);
    }
  };
  




  const saveExpensesToSupabase = async (messages: Message[]) => {
    try {
      for (const message of messages.filter((msg) => !msg.box)) {
        // Verifica se a mensagem já existe no banco
        const { data, error } = await supabase
          .from('expenses')
          .select('message_id, created_at')
          .eq('message_id', message.id)
          .single(); // Espera no máximo um registro
  
        if (error && error.code !== 'PGRST116') { // Código de erro que indica que o item não foi encontrado
          console.error('Erro ao buscar a mensagem no banco de dados:', error);
          return;
        }
  
        if (data) {
          // Se a mensagem já existir, vamos atualizá-la sem alterar o `created_at`
          await supabase
            .from('expenses')
            .update({
              expense: message.expense,
              value: message.value,
              status: message.status || 'Não Aplicável',
              category: message.category || 'Desconhecido',
              box: message.box !== undefined ? message.box : false,
              is_deleted: false,
            })
            .eq('message_id', message.id); // Atualiza somente os campos necessários
        } else {
          // Se a mensagem não existir, vamos inseri-la com `created_at` do momento da inserção
          await supabase
            .from('expenses')
            .insert([{
              message_id: message.id,
              expense: message.expense,
              value: message.value,
              status: message.status || 'Não Aplicável',
              category: message.category || 'Desconhecido',
              box: message.box !== undefined ? message.box : false,
              is_deleted: false,
              created_at: message.created_at, // A data original será salva aqui
            }]);
        }
      }
  
      console.log('Mensagens processadas corretamente');
    } catch (error) {
      console.error('Erro ao salvar ou atualizar despesas no Supabase:', error);
    }
  };




const groupMessagesByDay = (messages: any[]) => {
  const groupedMessages: { [date: string]: any[] } = {};

  // Agrupar as mensagens por dia
  messages.forEach((message) => {
    const messageDate = new Date(message.created_at);

    // Verifica se a data é válida
    if (isNaN(messageDate.getTime())) {
      console.warn(`Data inválida para a mensagem ${message.id}`);
      return; // Ignora mensagens com data inválida
    }

    const dateKey = messageDate.toISOString().split('T')[0];  // Ex: '2024-12-06'

    if (!groupedMessages[dateKey]) {
      groupedMessages[dateKey] = [];
    }

    groupedMessages[dateKey].push(message);
  });

  // Ordenar as mensagens de cada dia da mais nova para a mais antiga
  for (const dateKey in groupedMessages) {
    groupedMessages[dateKey].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  // Exibe o agrupamento para inspeção
  console.log("Mensagens agrupadas por dia:", JSON.stringify(groupedMessages, null, 2));

  return groupedMessages;
};


  const calculateDifferences = (dailyTotals) => {
    const comparisonResults = [];
    const dates = Object.keys(dailyTotals);

    for (let i = 1; i < dates.length; i++) {
      const currentDate = dates[i];
      const previousDate = dates[i - 1];

      const currentTotal = dailyTotals[currentDate];
      const previousTotal = dailyTotals[previousDate];

      const difference = currentTotal - previousTotal;
      const percentageChange = previousTotal !== 0 ? (difference / previousTotal) * 100 : 0;

      comparisonResults.push({
        currentDate,
        previousDate,
        currentTotal,
        previousTotal,
        difference,
        percentageChange,
      });
    }

    return comparisonResults;
  };

  const calculateDailyTotals = (groupedMessages) => {
    const dailyTotals = {};

    Object.entries(groupedMessages).forEach(([date, messages]) => {
      const totalValue = messages.reduce((sum, message) => sum + message.value, 0);
      dailyTotals[date] = totalValue;
    });

    return dailyTotals;
  };






  const generateColorForExpense = (expense: string) => {
    const expenseColors: { [key: string]: string } = {
      'Fatura': '#4CAF50',
      'Brilhete': '#FF5722',
      'gastos diversos': '#2196F3',
      'Aluguel': '#1E3A8A',
      'Mercado': '#388E3C',
      'Compras online': '#7B1FA2',
      'Transporte': '#0288D1',
      'Lazer': '#FF5722',
      'Saúde': '#00796B',
      'Educacao': '#64B5F6',
      'Caixinha': '#FF9800',
    };

    if (expenseColors[expense]) {
      return expenseColors[expense];
    }

    const colors = ['#FFEB3B', '#8BC34A', '#FF9800', '#03A9F4', '#9C27B0', '#FF5722', '#607D8B'];
    const hash = [...expense].reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const colorIndex = hash % colors.length;

    return colors[colorIndex];
  };

  // Ícones para as categorias
  const getCategoryIcon = (expense: string) => {
    const icons: { [key: string]: string } = {
      'Fatura': 'credit-card',  // Cartão de crédito
      'Brilhete': 'confirmation-number', // Bilhete
      'gastos diversos': 'attach-money', // Dinheiro
      'Aluguel': 'home', // Casa
      'Mercado': 'shopping-cart', // Carrinho de supermercado
      'Compras online': 'shopping-bag', // Sacola de compras
      'Transporte': 'directions-car', // Carro
      'Lazer': 'party-mode', // Festa
      'Saúde': 'local-hospital', // Hospital
      'Educacao': 'school', // Escola
      'Caixinha': 'money-off', // Dinheiro saindo (Caixinha)
    };

    return icons[expense] || 'category'; // Ícone padrão
  };


  // Função para marcar mensagem como deletada
  const markMessageAsDeleted = async (messageId: number) => {
    try {
      const { error } = await supabase
        .from('expenses')
        .update({ is_deleted: true })
        .eq('message_id', messageId);

      if (error) {
        console.error('Erro ao marcar mensagem como deletada:', error);
      } else {
        console.log(`Mensagem ${messageId} marcada como deletada.`);
      }
    } catch (error) {
      console.error('Erro ao marcar mensagem como deletada no Supabase:', error);
    }
  };

  // Função para sincronizar as mensagens com o Supabase e remover as apagadas
  const syncMessagesWithSupabase = async (latestMessages: Message[]) => {
    try {
      const messageIds = latestMessages.map((message) => message.id);

      // Buscar todas as mensagens do Supabase
      const { data: dbMessages, error } = await supabase
        .from('expenses')
        .select('message_id')
        .eq('is_deleted', false); // Apenas mensagens não deletadas

      if (error) {
        console.error('Erro ao buscar mensagens no Supabase:', error);
        return;
      }

      const dbMessageIds = dbMessages.map((message: any) => message.message_id);

      // Encontrar mensagens no DB que não estão mais no Telegram (apagadas)
      const messagesToDelete = dbMessageIds.filter(id => !messageIds.includes(id));

      if (messagesToDelete.length > 0) {
        // Deletar mensagens apagadas
        const { error: deleteError } = await supabase
          .from('expenses')
          .delete()
          .in('message_id', messagesToDelete);

        if (deleteError) {
          console.error('Erro ao deletar mensagens apagadas:', deleteError);
        } else {
          console.log('Mensagens apagadas removidas do Supabase.');
        }
      }

    } catch (error) {
      console.error('Erro ao sincronizar mensagens com o Supabase:', error);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, []);

  // Função de refrescar
  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMessages();
    await generateChartData();
    setRefreshing(false);
  };





  const [totalsByExpense, setTotalsByExpense] = useState<{ [key: string]: number }>({});
  const [totalValue, setTotalValue] = useState<number>(0); // Total geral de despesas

  // Função para buscar mensagens do Supabase
  const fetchMessagesFromDatabase = async () => {
    try {
      const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const endOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);

      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .gte('created_at', startOfMonth.toISOString())
        .lte('created_at', endOfMonth.toISOString())
        .eq('is_deleted', false);

      if (error) {
        console.error('Erro ao buscar mensagens do banco de dados:', error);
        return;
      }

      if (data) {
        const messages = data.map((item) => ({
          id: item.message_id,
          text: item.expense,
          value: item.value,
          status: item.status,
          category: item.category,
          box: item.box,
          operation: item.operation,
        }));

        setMessages(messages);
        calculateTotalsByExpense(messages); // Calcula os totais por expense
      }
    } catch (error) {
      console.error('Erro geral ao buscar mensagens do banco de dados:', error);
    }
  };

  const fetchLastMonthData = async () => {
    try {
      const currentDate = new Date();
      const startOfLastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
      const endOfLastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0);

      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .gte('created_at', startOfLastMonth.toISOString())
        .lte('created_at', endOfLastMonth.toISOString())
        .eq('is_deleted', false);

      if (error) {
        console.error('Erro ao buscar dados do mês passado:', error);
        return {};
      }

      if (data) {
        // Agrupar os dados por categoria e calcular os totais
        const lastMonthTotals = data.reduce((acc, item) => {
          const category = item.category || 'Outros';
          acc[category] = (acc[category] || 0) + parseFloat(item.value);
          return acc;
        }, {});

        return lastMonthTotals;
      }
      return {};
    } catch (error) {
      console.error('Erro geral ao buscar dados do mês passado:', error);
      return {};
    }
  };


  // Função para calcular os totais por expense
  const calculateTotalsByExpense = (messages: any[]) => {
    const totals: { [key: string]: number } = {};
    let total = 0;

    messages.forEach((message) => {
      if (message.value && !message.box) { // Filtra as mensagens de caixinha
        // Somar o total por expense, excluindo caixinhas
        if (totals[message.text]) {
          totals[message.text] += message.value;
        } else {
          totals[message.text] = message.value;
        }
        total += message.value; // Calcula o total geral
      }
    });

    setTotalsByExpense(totals); // Atualiza o estado com os totais calculados
    setTotalValue(total); // Atualiza o total geral
  };

  // Definindo as datas de início e fim do mês
  const currentMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const currentMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
  const [dailyExpensesCurrentMonth, setDailyExpensesCurrentMonth] = useState<{ [key: string]: number }>({});
  const [dailyExpensesPreviousMonth, setDailyExpensesPreviousMonth] = useState<{ [key: string]: number }>({});
  const [chartDataMensal, setChartDataMensal] = useState<any>(null);

  // Função para calcular os gastos diários
  const calculateDailyExpenses = (messages: any[]) => {
    const dailyExpenses: { [key: string]: number } = {};

    messages.forEach((message) => {
      if (message.value && message.created_at) {
        const createdAt = new Date(message.created_at);
        const localDate = new Date(createdAt.getTime() - createdAt.getTimezoneOffset() * 60000); // Ajuste para o fuso horário local
        const date = localDate.toISOString().split('T')[0];

        if (!dailyExpenses[date]) {
          dailyExpenses[date] = 0;
        }
        dailyExpenses[date] += message.value;
      }
    });

    return dailyExpenses;
  };

// Função para buscar as mensagens e calcular comparações diárias
const fetchMessagesForMonth = async (startDate: Date, endDate: Date) => {
  try {
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .eq('is_deleted', false); // Certifique-se de que não são mensagens deletadas

    if (error) {
      console.error('Erro ao buscar mensagens:', error);
      return [];
    }

    console.log("Dados obtidos do Supabase:", data); // Verifique os dados recebidos

    // Se os dados estiverem vazios, não há necessidade de continuar o processo
    if (!data || data.length === 0) {
      console.log("Nenhum dado encontrado.");
      return [];
    }

    // Agrupar as despesas por dia
    const groupedByDay = data.reduce((acc, item) => {
      const day = new Date(item.created_at).toISOString().split('T')[0]; // Agrupar por data (ano-mês-dia)

      if (!acc[day]) {
        acc[day] = { total: 0, expenses: [] };
      }

      acc[day].expenses.push(item);
      acc[day].total += item.value;

      return acc;
    }, {});

    console.log("Dados agrupados por dia:", groupedByDay); // Verifique os dados agrupados

    // Organize os dados agrupados em um array
    const groupedData = Object.keys(groupedByDay).map((date) => ({
      date,
      total: groupedByDay[date].total,
      expenses: groupedByDay[date].expenses,
    }));

    console.log("Dados organizados:", groupedData); // Verifique os dados organizados

    // Calcular as comparações entre os dias
    const comparisonResults = [];
    for (let i = 1; i < groupedData.length; i++) {
      const previousDay = groupedData[i - 1];
      const currentDay = groupedData[i];

      const difference = currentDay.total - previousDay.total;
      const percentageChange = previousDay.total
        ? ((difference / previousDay.total) * 100)
        : 0;

      comparisonResults.push({
        previousDate: previousDay.date,
        currentDate: currentDay.date,
        previousTotal: previousDay.total,
        currentTotal: currentDay.total,
        difference,
        percentageChange,
      });
    }

    console.log("Comparações diárias:", comparisonResults); // Verifique as comparações geradas

    return comparisonResults;
  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
    return [];
  }
};

// Função que carrega as comparações diárias com base no mês atual
const loadComparisonData = async () => {
  // Obter o mês atual
  const currentDate = new Date();
  
  // Calcular o primeiro e último dia do mês atual
  const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1); // Primeiro dia do mês
  const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0); // Último dia do mês

  console.log("Início do mês:", startDate);
  console.log("Fim do mês:", endDate);

  const results = await fetchMessagesForMonth(startDate, endDate);
  setComparisonResults(results); // Armazenar os resultados
};

useEffect(() => {
  loadComparisonData();
}, []);
  // Função para calcular a porcentagem de cada despesa
  const calculatePercentage = (expenseValue: number) => {
    return totalValue > 0 ? (expenseValue / totalValue) * 100 : 0;
  };

  // Função para buscar os dados das caixinhas do Supabase
  const fetchBoxDataFromSupabase = async () => {
    try {
      // Buscar os dados da tabela caixinhas
      const { data, error } = await supabase
        .from('caixinhas')
        .select('*')
        .eq('is_deleted', false); // Só busca as caixinhas não deletadas

      if (error) {
        console.error('Erro ao buscar dados das caixinhas:', error);
        return [];
      }

      return data; // Retorna os dados das caixinhas
    } catch (error) {
      console.error('Erro ao buscar dados das caixinhas:', error);
      return [];
    }
  };

  // Função para calcular o valor total da caixinha
  const calculateBoxValue = (boxName: string, boxData: any[]) => {
    // Filtra os dados das caixinhas pelo nome
    const filteredMessages = boxData.filter((message) => message.expense === boxName);

    console.log('Mensagens filtradas para a caixinha', boxName, filteredMessages);

    // Reduz os dados para calcular o total da caixinha
    const total = filteredMessages.reduce((total, message) => {
      console.log('Processando mensagem:', message);

      if (message.operation === 'mais') {
        console.log('Adicionando valor:', message.value);
        return total + parseFloat(message.value); // Converte para número
      } else if (message.operation === 'menos') {
        console.log('Subtraindo valor:', message.value);
        return total - parseFloat(message.value);
      }
      return total;
    }, 0);

    console.log('Valor final da caixinha', boxName, ': R$', total);
    calculateCDIRender(boxName, total)
    return total;
  };
  // Função para calcular o valor atualizado com o CDI e aplicar o IR (sem atualizar o valor da caixinha)
  const calculateCDIRender = async (boxName: string, boxValue: number) => {
    try {
      // Certificando-se de que boxValue seja um número válido
      const parsedValue = parseFloat(boxValue.toString());  // Converte para número, caso não seja um número

      if (isNaN(parsedValue)) {
        console.error('Erro: boxValue não é um número válido');
        return 0; // Se não for um número válido, retorna 0
      }

      // 1. CDI mensal: 0,79% ao mês (0.0079)
      const cdiMonthly = 0.0079;

      // 2. CDI ajustado para 102%
      const adjustedCDI = cdiMonthly;

      // 3. Calcular o ganho com o CDI ajustado
      const cdiGain = parsedValue * adjustedCDI;

      // 4. Aplicar o Imposto de Renda (IR) de 20% sobre o ganho
      const irDeduction = cdiGain * 0.20;

      // 5. Rendimento líquido após o CDI e IR
      const netCdiGain = cdiGain - irDeduction;

      // Formatando o valor para 2 casas decimais
      const formattedValue = netCdiGain.toFixed(2);

      console.log(`Rendimento da caixinha ${boxName} com CDI e IR: R$ ${formattedValue}`);
      return formattedValue; // Retorna o valor formatado
    } catch (error) {
      console.error('Erro ao calcular o rendimento com CDI e IR:', error);
      return 0; // Retorna 0 em caso de erro
    }
  };


  const [boxData, setBoxData] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const data = await fetchBoxDataFromSupabase(); // Buscar dados do Supabase
      setBoxData(data); // Atualizar o estado com os dados recebidos
    };

    fetchData();
  }, []);

  // Função para gerar os dados dinâmicos do gráfico
  const generateChartData = () => {
    const labels = Object.keys(totalsByExpense);
    const data = labels.map((expense) => calculatePercentage(totalsByExpense[expense]) / 100);

    return { labels, data };
  };

  // Função para filtrar as mensagens
  const filterMessages = () => {
    return messages.filter((message) =>
      filterExpense ? message.expense === filterExpense : true // Filtro correto com message.expense
    );
  };



  useEffect(() => {
    fetchMessagesFromDatabase();
  }, []);


  const screenWidth = Dimensions.get("window").width;

  const chartData = generateChartData();
  const chartConfig = {
    backgroundGradientFrom: "#262626",
    backgroundGradientTo: "#262626",
    decimalPlaces: 2,
    color: (opacity = 1) => `rgba(0, 255, 255, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
    style: {
      borderRadius: 16, // Bordas arredondadas
    },
    propsForDots: {
      r: "6", // Tamanho dos pontos
      strokeWidth: "2", // Largura da borda dos pontos
    },
  };

  useEffect(() => {
    console.log('Filtro atual:', filterExpense);
    console.log('Mensagens filtradas:', filterMessages());
  }, [filterExpense]);


  useEffect(() => {
    console.log('totalsByExpense:', totalsByExpense);
  }, [totalsByExpense]);

  useEffect(() => {
    if (Object.keys(totalsByExpense).length > 0) {
      console.log('Picker será atualizado com:', totalsByExpense);
    }
  }, [totalsByExpense]);

  const [caixinhas, setCaixinhas] = useState([]);

  useEffect(() => {
    const fetchCaixinhas = async () => {
      const uniqueBoxNames = Array.from(
        new Set(boxData.filter((message) => message.box).map((message) => message.expense))
      );

      const caixinhaData = await Promise.all(
        uniqueBoxNames.map(async (boxName) => {
          const boxValue = calculateBoxValue(boxName, boxData);

          // Verifica se hoje é um dia útil (segunda a sexta-feira)
          const today = new Date();
          const isWeekday = today.getDay() > 0 && today.getDay() < 6; // 0 = Domingo, 6 = Sábado

          let boxRendimento = 0;
          if (isWeekday) {
            boxRendimento = await calculateCDIRender(boxName, boxValue);
            console.log(`Rendimento de ${boxRendimento} adicionado à caixinha ${boxName}`);
          } else {
            console.log('Hoje não é um dia útil, rendimento não será calculado.');
          }

          return { boxName, boxValue, boxRendimento };
        })
      );

      setCaixinhas(caixinhaData);
    };

    fetchCaixinhas();
  }, [boxData]);

  const addDailyRendimentoToBox = async (boxName: string, rendimento: number) => {
    if (rendimento > 0) {
      try {
        // Adicione o rendimento ao banco de dados aqui
        await supabase
          .from('caixinhas')
          .insert({ box: boxName, value: rendimento, operation: 'mais', createdAt: new Date() });

        console.log(`Rendimento de R$ ${rendimento} adicionado à caixinha ${boxName}.`);
      } catch (error) {
        console.error(`Erro ao adicionar rendimento à caixinha ${boxName}:`, error);
      }
    }
  };
  useEffect(() => {
    const scheduleDailyUpdate = () => {
      const now = new Date();
      const millisTillEndOfDay =
        new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0).getTime() - now.getTime();

      setTimeout(async () => {
        const uniqueBoxNames = Array.from(
          new Set(boxData.filter((message) => message.box).map((message) => message.expense))
        );

        for (const boxName of uniqueBoxNames) {
          const boxValue = calculateBoxValue(boxName, boxData);
          const boxRendimento = await calculateCDIRender(boxName, boxValue);
          addDailyRendimentoToBox(boxName, parseFloat(boxRendimento));
        }
        scheduleDailyUpdate();
      }, millisTillEndOfDay);
    };

    scheduleDailyUpdate();
  }, [boxData]);


  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const formatDate = (date: string) => {
    const dateObj = new Date(date);
    return dateObj.toLocaleDateString('pt-BR');
  };



  
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent} // Garante que o conteúdo ocupe mais espaço
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Título da página */}
      <Text style={styles.title}>Últimos Registros</Text>

      {/* Filtros de gastos */}
      <FlatList
        data={Object.keys(messages)} // Use as chaves (datas) como dados para o FlatList
        keyExtractor={(item) => item}
        renderItem={({ item, index }) => {
          const dayMessages = messages[item] || []; // As mensagens do dia (garante que seja um array vazio se não existir)
          const isExpanded = expandedIndex === index; // Verifica se o item está expandido

          // Verifica se dayMessages é um array antes de usar reduce
          const totalDayValue = Array.isArray(dayMessages)
            ? dayMessages.reduce((sum, msg) => sum + msg.value, 0)
            : 0; // Calcula o total do dia

          // Função para alternar entre expandido e colapsado
          const toggleExpand = () => {
            setExpandedIndex(isExpanded ? null : index); // Alterna o estado de expandir
          };

          return (
            <View style={[styles.dayContainer, { flexShrink: 1 }]}>
              {/* Data */}
              <TouchableOpacity onPress={toggleExpand}>
                <Text style={styles.dateText1}>{item}</Text> {/* Exibe a data formatada */}
              </TouchableOpacity>

              {/* Se o dia estiver expandido, mostra o FlatList de mensagens */}
              {isExpanded && (
                <FlatList
                  data={dayMessages}
                  keyExtractor={(msg) => msg.id.toString()}
                  renderItem={({ item }) => {
                    const percentage = totalDayValue > 0 ? (item.value / totalDayValue) * 100 : 0; // Calcula a porcentagem do valor no dia

                    return (
                      <View style={[styles.cardContainer]}>
                        <View style={styles.iconContainer}>
                          <View style={[styles.iconCircle, { backgroundColor: generateColorForExpense(item.expense) || '#ccc' }]}>
                            <View>
                              <Icon
                                name={getCategoryIcon(item.expense)}
                                size={24}
                                color="#fff"
                              />
                            </View>
                          </View>
                        </View>

                        <View style={styles.cardContent}>
                          <Text style={styles.cardText}>
                            {item.box ? (
                              `Caixinha: ${item.expense}  ${item.operation === 'mais' ? '➕' : '➖'}`
                            ) : (
                              `${item.expense}`
                            )}
                          </Text>
                          <View style={styles.valueContainer}>
                            <Text style={styles.valueText}>R$ {item.value.toFixed(2)}</Text>
                            <Text style={styles.percentageText}>{percentage.toFixed(1)}%</Text>
                          </View>
                        </View>
                      </View>
                    );
                  }}
                  showsVerticalScrollIndicator={true}
                  style={styles.flatListContainer}
                />
              )}
                <View style={styles.spaceAfterChart} />
            </View>
          );
        }}
        showsVerticalScrollIndicator={false}
      />

      {/* Seção de Caixinhas */}
      <View style={styles.boxContainer}>
        <Text style={styles.boxTitle}>Caixinhas</Text>

        {caixinhas.map(({ boxName, boxValue, boxRendimento, boxColor }) => (
          <View key={boxName} style={[styles.boxCardContainer, { backgroundColor: boxColor || '#F0F0F0' }]}>

            {/* Título da Caixinha com ícone */}
            <View style={styles.boxHeader}>
              <Text style={styles.boxCardTitle}>{boxName}</Text>
              <Icon name="wallet" size={24} color="#CC4709FF" style={styles.boxIcon} />
            </View>

            {/* Valores */}
            <View style={styles.boxValueContainer}>
              <Text style={styles.boxCardText}>
                <Text style={styles.valueLabel}>Valor Inicial: </Text>
                <Text style={{ color: parseFloat(boxValue) < 0 ? 'red' : 'black' }}>
                  R$ {new Intl.NumberFormat('pt-BR').format(Math.abs(boxValue).toFixed(2))}
                </Text>
              </Text>

              <Text style={styles.boxCardText}>
                <Text style={styles.valueLabel}>Rendimento: </Text>
                <Text style={{ color: parseFloat(boxRendimento) < 0 ? 'red' : 'green' }}>
                  {parseFloat(boxRendimento) < 0 ? '- R$ ' : '+ R$ '}
                  {new Intl.NumberFormat('pt-BR').format(Math.abs(parseFloat(boxRendimento)).toFixed(2))}
                </Text>
              </Text>
            </View>

            {/* Rendimento Total (opcional) */}
            <View style={styles.boxFooter}>
              <Text style={{
                color: (parseFloat(boxValue) + parseFloat(boxRendimento)) < 0 ? 'red' : 'black',
                ...styles.totalText
              }}>
                Total: R$ {new Intl.NumberFormat('pt-BR').format((boxValue + parseFloat(boxRendimento)).toFixed(2))}
              </Text>
            </View>
          </View>
        ))}
      </View>


      <View style={styles.analysisContainer}>
      <Text style={styles.analysisTitle}>Comparação Diária</Text>

      {comparisonResults && comparisonResults.length > 0 ? (
        comparisonResults.map((result, index) => {
          const differenceColor = result.difference >= 0 ? 'green' : 'red';

          return (
            <View key={index} style={styles.comparisonContainer}>
              <Text style={styles.comparisonText}>
                <Text style={styles.dateText}>
                  {result.previousDate} → {result.currentDate}:
                </Text>
              </Text>
              <Text style={styles.previousDayText}>
                Gasto no Dia Anterior: R$ {new Intl.NumberFormat('pt-BR').format(result.previousTotal.toFixed(2))}
              </Text>
              <Text style={styles.currentDayText}>
                Gasto no Dia Atual: R$ {new Intl.NumberFormat('pt-BR').format(result.currentTotal.toFixed(2))}
              </Text>
              <Text style={{ color: differenceColor }}>
                Diferença: R$ {new Intl.NumberFormat('pt-BR').format(result.difference.toFixed(2))}, {result.percentageChange.toFixed(2)}%
              </Text>
            </View>
          );
        })
      ) : (
        <Text style={styles.noComparisonText}>Não há comparações para exibir.</Text>
      )}
    </View>



      {/* Total gasto este mês */}
      <Text style={styles.monthlyTotalText}>
        Total Gasto Este Mês: R$ {new Intl.NumberFormat('pt-BR').format(totalValue)}
      </Text>

      {/* Gráfico de progresso */}
      <ProgressChart
        data={chartData}
        width={screenWidth * 0.9}
        height={220}
        strokeWidth={16}
        radius={32}
        chartConfig={chartConfig}
        hideLegend={false}
      />
      <View style={styles.spaceAfterChart} />
      <StatusBar style="auto" />
    </ScrollView>
  );

};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#141414',
  },
  scrollContent: {
    flexGrow: 1,
    minHeight: Dimensions.get('window').height,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#6200ea',
    marginBottom: 20,
    marginTop: '5%',
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginVertical: 10,
  },
  filterButton: {
    backgroundColor: '#e0e0e0',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    margin: 5,
  },
  activeButton: {
    backgroundColor: '#6200ea', // Cor do botão ativo
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  cardContainer: {
    backgroundColor: '#ffff',
    flexDirection: 'row',
    marginBottom: 10,
    padding: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
    marginHorizontal: 10,
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconText: {
    fontSize: 20,
    color: '#fff',  // Cor do ícone (branco)
  },
  cardContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  cardText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  valueContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  valueText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    opacity: 0.6,  // Valor sutil
  },
  percentageText: {
    fontSize: 12,
    color: '#73AE38FF',  // Cor mais suave para a porcentagem
  },
  flatListContainer: {
    maxHeight: 300,  // Define o limite máximo de altura
  },
  analysisContainer: {
    marginVertical: 20,
    padding: 20,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    width: '100%',
  },
  analysisTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#6200ea',
  },
  monthlyTotalText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#00FFFF',
    marginBottom: 12,
  },
  comparisonContainer: {
    marginBottom: 12,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  comparisonText: {
    fontSize: 14,
    color: '#444',
  },
  previousDayText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginVertical: 4,
  },
  currentDayText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginVertical: 4,
  },
  boxContainer: {
    marginTop: '5%',
    marginBottom: 20,
    padding: 10,
    backgroundColor: '#262626',
    borderRadius: 20,
    marginEnd: '5%',
  },
  boxTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#6200ea',
    marginBottom: 15,
  },
  boxCardContainer: {
    marginBottom: 10,
    borderRadius: 10,
    padding: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 2.22,
    elevation: 3,
  },
  boxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  boxCardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#CC4709FF',
  },
  boxIcon: {
    backgroundColor: '#fff',
    padding: 5,
    borderRadius: 20,
  },
  boxValueContainer: {
    marginTop: 10,
  },
  boxCardText: {
    fontSize: 16,
    color: '#333',
    marginBottom: 5,
  },
  valueLabel: {
    fontWeight: 'bold',
  },
  boxFooter: {
    marginTop: 10,
    alignItems: 'flex-end',
  },
  totalText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#388E3C',
  },

  dayContainer: {
    marginBottom: 20,
    padding: 10,
    backgroundColor: '#262626',
    borderRadius: 20,
    marginEnd: '5%',
  },
  dateHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#ffff',
    textAlign: 'center',
  },
  dateText: {
    color: '#000',
    textAlign: 'center',
    marginBottom: '4%',
  },
  dateText1: {
    color: '#ffff',
    textAlign: 'center',
    marginBottom: '4%',
  },
  spaceAfterChart: {
    height: 50,
  },
});
