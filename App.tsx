import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, FlatList, RefreshControl, TouchableOpacity, ScrollView } from 'react-native';
import axios from 'axios';
import { Picker } from '@react-native-picker/picker';
import { createClient } from '@supabase/supabase-js';
import { Svg, G, Circle, Text as SvgText } from "react-native-svg";
import {
  LineChart,
  BarChart,
  PieChart,
  ProgressChart,
  ContributionGraph,
  StackedBarChart
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

  const [comparisonData, setComparisonData] = useState({});
  const [maxIncrease, setMaxIncrease] = useState(null);
  const [maxDecrease, setMaxDecrease] = useState(null);
  
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


  const fetchMessages = async () => {
    try {
      // Definindo o começo e o final do dia atual
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0); // Começo do dia (meia-noite)
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999); // Fim do dia (23:59:59.999)

      const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`;
      const response = await axios.get(url);
      const updates = response.data.result;

      const allMessages = updates
        .map((update: any) => {
          const message = update.message || update.edited_message;
          const messageDate = new Date(message?.date * 1000); // A data vem em timestamp, convertendo para Date

          // Filtra mensagens enviadas no dia atual
          if (message?.chat?.id === parseInt(CHAT_ID) && messageDate >= startOfDay && messageDate <= endOfDay) {
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
        .filter(Boolean);

      console.log('Mensagens enviadas hoje:', allMessages);
      setMessages(allMessages);

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
      const { data, error } = await supabase
        .from('caixinhas')
        .upsert(
          messages
            .filter(message => message.box)  // Filtra as mensagens que são caixinhas
            .map((message) => ({
              message_id: message.id,
              expense: message.expense,
              value: message.value,
              operation: message.operation,  // Operação (mais/menos)
              category: message.category,
              box: true,  // Sempre true para caixinha
              is_deleted: false,
              // Não inclui 'status' para caixinhas
            })),
          { onConflict: ['message_id'] }
        );

      if (error) {
        console.error('Erro ao salvar mensagens na tabela "caixinhas":', error);
      } else {
        console.log('Mensagens salvas ou atualizadas na tabela "caixinhas":', data);
      }
    } catch (error) {
      console.error('Erro ao salvar caixinhas no Supabase:', error);
    }
  };




  const saveExpensesToSupabase = async (messages: Message[]) => {
    try {
      const { data, error } = await supabase
        .from('expenses')
        .upsert(
          messages
            .filter(message => !message.box)  // Filtra as mensagens que não são caixinhas
            .map((message) => ({
              message_id: message.id,
              expense: message.expense,
              value: message.value,
              status: message.status || 'Não Aplicável',  // Valor padrão para status
              category: message.category || 'Desconhecido',  // Categoria padrão
              is_deleted: false,
              box: message.box !== undefined ? message.box : false,
            })),
          { onConflict: ['message_id'] }
        );

      if (error) {
        console.error('Erro ao salvar mensagens na tabela "expenses":', error);
      } else {
        console.log('Mensagens salvas ou atualizadas na tabela "expenses":', data);
      }
    } catch (error) {
      console.error('Erro ao salvar despesas no Supabase:', error);
    }
  };

  const generateColorForExpense = (expense: string) => {
    // Definindo cores específicas para cada tipo de gasto
    const expenseColors: { [key: string]: string } = {
      'Fatura': '#4CAF50',
      'Brilhete': '#FF5722',
      'gastos diversos': '#2196F3', // Azul para gastos diversos
      'Aluguel': '#1E3A8A', // Azul escuro para aluguel
      'Mercado': '#388E3C', // Verde para mercado
      'Compras online': '#7B1FA2', // Roxo para compras online
      'Transporte': '#0288D1', // Azul claro para transporte
      'Lazer': '#FF5722', // Laranja para lazer
      'Saúde': '#00796B', // Verde-azulado para saúde
      'Educacao': '#64B5F6', // Azul claro para educação
      'Caixinha': '#FF9800',
    };

    // Se o tipo de 'expense' for um dos definidos, retorna a cor correspondente
    if (expenseColors[expense]) {
      return expenseColors[expense];
    }

    // Caso contrário, gera uma cor aleatória entre algumas cores mais suaves
    const colors = [
      '#FFEB3B', '#8BC34A', '#FF9800', '#03A9F4', '#9C27B0', '#FF5722', '#607D8B'
    ];

    const hash = [...expense].reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const colorIndex = hash % colors.length;

    return colors[colorIndex];
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

  
  useEffect(() => {
    const fetchMonthlyComparison = async () => {
      try {
        const lastMonthData = await fetchLastMonthData(); // Busca os dados do mês passado
        const comparison = compareWithLastMonth(totalsByCategory, lastMonthData); // Faz a comparação
        setComparisonData(comparison);

        // Identificar maior aumento e redução
        let maxIncrease = { category: null, difference: -Infinity };
        let maxDecrease = { category: null, difference: Infinity };

        for (const [category, data] of Object.entries(comparison)) {
          if (data.difference > maxIncrease.difference) {
            maxIncrease = { category, ...data };
          }
          if (data.difference < maxDecrease.difference) {
            maxDecrease = { category, ...data };
          }
        }

        setMaxIncrease(maxIncrease);
        setMaxDecrease(maxDecrease);
      } catch (error) {
        console.error('Erro ao carregar análise de gastos:', error);
      }
    };

    fetchMonthlyComparison();
  }, [totalsByCategory]);



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

  // Função para buscar as mensagens
  const fetchMessagesForMonth = async (startDate: Date, endDate: Date) => {
    try {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .eq('is_deleted', false);

      if (error) {
        console.error('Erro ao buscar mensagens:', error);
        return [];
      }

      return data;
    } catch (error) {
      console.error('Erro ao buscar mensagens:', error);
      return [];
    }
  };

  const chartConfig2 = {
    backgroundColor: '#ffffff',
    backgroundGradientFrom: '#ffffff',
    backgroundGradientTo: '#ffffff',
    withShadow: false, // Desativa a sombra
    decimalPlaces: 2,
    withDots: true, // Exibe os pontos
    fromZero: true, // Começa o gráfico do zero
    color: (opacity = 1) => `rgba(255, 99, 132, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
    style: {
      borderRadius: 16, // Bordas arredondadas
    },
    propsForDots: {
      r: '3', // Tamanho dos pontos
      strokeWidth: '2', // Largura da borda dos pontos
    },
  };


  console.log('Dados do gráfico:', chartDataMensal);




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
    backgroundColor: "#ffffff", // Cor de fundo principal
    backgroundGradientFrom: "#ffffff", // Gradiente do fundo inicial
    backgroundGradientTo: "#ffffff", // Gradiente do fundo final
    decimalPlaces: 2, // Opcional, padrão 2 casas decimais
    color: (opacity = 1) => `rgba(128, 0, 128, ${opacity})`, // Cor roxa para a linha
    labelColor: (opacity = 1) => `rgba(128, 0, 128, ${opacity})`,
    style: {
      borderRadius: 16, // Bordas arredondadas
    },
    propsForDots: {
      r: "6", // Tamanho dos pontos
      strokeWidth: "2", // Largura da borda dos pontos
      stroke: "#FFA726FF", // Cor da borda dos pontos
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

        // Reagendar para o próximo dia
        scheduleDailyUpdate();
      }, millisTillEndOfDay);
    };

    scheduleDailyUpdate();
  }, [boxData]);

  return (
    <ScrollView style={styles.container}> {/* Adiciona rolagem vertical */}
      <Text style={styles.title}>Últimos Registros</Text>

      <View style={styles.buttonContainer}>
        {/* Botão para todos os gastos */}
        <TouchableOpacity
          style={[
            styles.filterButton,
            !filterExpense && styles.activeButton, // Destaca o botão ativo
          ]}
          onPress={() => setFilterExpense('')}
        >
          <Text style={styles.buttonText}>Todos os Gastos</Text>
        </TouchableOpacity>

        {/* Botões dinâmicos para cada gasto */}
        {Object.keys(totalsByExpense).map((expense) => (
          <TouchableOpacity
            key={expense}
            style={[
              styles.filterButton,
              filterExpense === expense && styles.activeButton, // Destaca o botão ativo
            ]}
            onPress={() => setFilterExpense(expense)}
          >
            <Text style={styles.buttonText}>{expense}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filterMessages()}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <View style={[styles.cardContainer, { backgroundColor: item.color }]}>
            <Text style={styles.cardText}>
              {item.box ? (
                `Caixinha: ${item.expense} - ${item.operation === 'mais' ? '➕' : '➖'} ${item.value}`
              ) : (
                `${item.expense} - ${item.value} - ${item.status === 'Pago' ? '✅ Pago' : '❌ Não Pago'} - Categoria: ${item.category || 'Desconhecido'}`
              )}
            </Text>
          </View>
        )}
        horizontal={true}
        showsHorizontalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />

      {/* Seção de Caixinhas */}
      <View style={styles.boxContainer}>
        <Text style={styles.boxTitle}>Caixinhas</Text>
        {caixinhas.map(({ boxName, boxValue, boxRendimento }) => (
          <View key={boxName} style={styles.boxCardContainer}>
            <Text style={styles.boxCardText}>
              {boxName}: R$ {new Intl.NumberFormat('pt-BR').format(boxValue.toFixed(2))}
            </Text>
            <Text style={styles.boxCardText}>
              +: R$ {new Intl.NumberFormat('pt-BR').format(parseFloat(boxRendimento).toFixed(2))}
            </Text>
          </View>
        ))}
      </View>
      {/* Seção de Análise de Gastos Mensais */}
      <View style={styles.analysisContainer}>
        <Text style={styles.analysisTitle}>Análise de Gastos Mensais</Text>
        <Text style={styles.analysisText}>Total Geral: R$ {new Intl.NumberFormat('pt-BR').format(totalValue.toFixed(2))}</Text>

        {comparisonData &&
          Object.entries(comparisonData).map(([category, data]) => (
            <Text key={category} style={styles.analysisText}>
              {category}: R$ {new Intl.NumberFormat('pt-BR').format(data.currentValue.toFixed(2))} (Diferença: R$ {new Intl.NumberFormat('pt-BR').format(data.difference.toFixed(2))}, {data.percentageChange.toFixed(2)}%)
            </Text>
          ))}

        {maxIncrease && (
          <Text style={styles.analysisText}>
            Maior aumento: {maxIncrease.category} (R$ {new Intl.NumberFormat('pt-BR').format(maxIncrease.difference.toFixed(2))}, {maxIncrease.percentageChange.toFixed(2)}%)
          </Text>
        )}
        {maxDecrease && (
          <Text style={styles.analysisText}>
            Maior redução: {maxDecrease.category} (R$ {new Intl.NumberFormat('pt-BR').format(maxDecrease.difference.toFixed(2))}, {maxDecrease.percentageChange.toFixed(2)}%)
          </Text>
        )}
      </View>

      {/* Total gasto este mês */}
      <Text style={styles.monthlyTotalText}>
        Total Gasto Este Mês: R$ {new Intl.NumberFormat('pt-BR').format(totalValue)}
      </Text>

      {/* ProgressChart */}
      <ProgressChart
        data={chartData}
        width={screenWidth}
        height={220}
        strokeWidth={16}
        radius={32}
        chartConfig={chartConfig}
        hideLegend={false}
      />
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f9f9f9', // Cor de fundo suave para todo o layout
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
    gap: 10,
    margin: 10,
    borderRadius: 12,
    padding: 15,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 7, // Para Android
    shadowColor: '#000', // Cor da sombra
    shadowOffset: { width: 2, height: 4 }, // Posição da sombra
    shadowOpacity: 0.3, // Opacidade da sombra
    shadowRadius: 3.5, // Tamanho da sombra
  },
  cardText: {
    fontSize: 16,
    color: '#FFFFFF',
    textAlign: 'center',
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
  analysisText: {
    fontSize: 16,
    color: '#333',
    marginVertical: 5,
  },
  boxContainer: {
    marginVertical: 20,
    padding: 20,
    borderRadius: 10,
    width: '100%',

  },
  boxTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#6200ea',
  },
  boxCardContainer: {
    flexDirection: 'row',
    padding: 15,
    backgroundColor: '#FF9800',
    borderRadius: 12,
    marginBottom: 10,
    elevation: 4,
    shadowOpacity: 0.3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },

    shadowRadius: 3.5,
  },
  boxCardText: {
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
  },
  monthlyTotalText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginVertical: 15,
    textAlign: 'center',
  },
});
