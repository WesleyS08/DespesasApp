import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, FlatList, RefreshControl } from 'react-native';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { Svg, G, Circle, Text as SvgText } from "react-native-svg";

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



  // Função para analisar o texto da mensagem
  const parseMessageDetails = (message: string): { expense?: string; value?: number; status?: string; category?: string; box?: boolean; operation?: 'mais' | 'menos'; } | null => {
    if (message.toLowerCase().includes('deletar')) {
      return null;  // Ignora a mensagem
    }

    // Verificar se é uma "caixinha"
    const caixaRegex = /Caixinha:\s*([a-zA-Z\s]+)\s*-\s*(mais|menos)\s*(\d+(\.\d+)?)/i;
    const caixaMatch = message.match(caixaRegex);

    if (caixaMatch) {
      return {
        box: true,
        expense: caixaMatch[1].trim(),
        value: parseFloat(caixaMatch[3]),
        operation: caixaMatch[2] === 'mais' ? 'mais' : 'menos',
      };
    }

    // Caso contrário, analisar como uma despesa
    const regex = /([a-zA-Z\s]+)\s*-\s*(\d+)\s*-\s*(Pago|Não\sPago)/i;
    const match = message.match(regex);

    if (match) {
      return {
        expense: match[1].trim(),
        value: parseFloat(match[2]),
        status: match[3] === 'Pago' ? 'Pago' : 'Não Pago',
        category: message.includes('Categoria:') ? message.split('Categoria:')[1].trim() : 'Desconhecido',
      };
    }

    return null;
  };

  // Função para buscar mensagens do Telegram
  const fetchMessages = async () => {
    try {
      const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`;
      const response = await axios.get(url);

      const updates = response.data.result;

      const allMessages = updates
        .map((update: any) => {
          const message = update.message || update.edited_message;
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
              color: expenseColor,  // Cor para o `expense`
            };
          }
          return null;
        })
        .filter(Boolean);

      const latestMessages = allMessages
        .sort((a, b) => b.id - a.id)
        .slice(0, 5);

      setMessages(latestMessages);

      await saveMessagesToSupabase(latestMessages);
      await syncMessagesWithSupabase(latestMessages);

    } catch (error) {
      console.error('Erro ao buscar mensagens:', error);
    }
  };

  const generateColorForExpense = (expense: string) => {
    const colors = [
      '#FF6347', '#4682B4', '#32CD32', '#FFD700', '#FF69B4', '#8A2BE2', '#FF4500'
    ];
    const hash = [...expense].reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const colorIndex = hash % colors.length;
    return colors[colorIndex];
  };
  // Função para salvar mensagens no Supabase
  const saveMessagesToSupabase = async (messages: Message[]) => {
    try {
      const { data, error } = await supabase
        .from('expenses')
        .upsert(
          messages.map((message) => ({
            message_id: message.id,  // Usando o message_id como chave única
            expense: message.expense,
            value: message.value,
            status: message.status,
            category: message.category || 'Desconhecido', // Definindo categoria ou valor padrão
            is_deleted: false,  // Marcar como não deletada
          })),
          { onConflict: ['message_id'] }
        );

      if (error) {
        console.error('Erro ao salvar mensagens no Supabase:', error);
      } else {
        console.log('Mensagens salvas ou atualizadas no Supabase:', data);
      }
    } catch (error) {
      console.error('Erro ao salvar mensagens no Supabase:', error);
    }
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
        calculateMonthlyTotal(messages); // Calcula o total do mês
      }
    } catch (error) {
      console.error('Erro geral ao buscar mensagens do banco de dados:', error);
    }
  };

  // Função para calcular o total das despesas do mês
  const calculateMonthlyTotal = (messages: Message[]) => {
    const total = messages.reduce((sum, message) => {
      if (message.value && message.status === 'Pago') {
        return sum + message.value;
      }
      return sum;
    }, 0);

    setMonthlyTotal(total);
  };


  const size = 200; // Tamanho total do gráfico
  const strokeWidth = 20; // Largura do traço
  const radius = (size - strokeWidth) / 2; // Raio do círculo
  const circumference = 2 * Math.PI * radius; // Comprimento do círculo
  const gap = 2; // Espaço entre os segmentos

  // Dados de exemplo (cada despesa com seu valor e cor)
  const expenses = [
    { expense: "Alimentação", value: 300, color: "#5271FF" },
    { expense: "Transporte", value: 120, color: "#FF5E57" },
    { expense: "Lazer", value: 180, color: "#45C467" },
    { expense: "Educação", value: 250, color: "#8C57F9" },
    { expense: "Outros", value: 150, color: "#FFB74D" },
  ];

  const totalValue = expenses.reduce((sum, item) => sum + item.value, 0);

  // Prepara os dados para o gráfico
  const createChart = expenses.map((item, index) => {
    const percentage = (item.value / totalValue) * 100;
    const offset =
      expenses
        .slice(0, index)
        .reduce((sum, d) => sum + (d.value / totalValue) * circumference, 0);

    return {
      ...item,
      percentage: percentage.toFixed(2),
      offset: offset + gap * index,
    };
  });

  useEffect(() => {
    fetchMessagesFromDatabase();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mensagens do Usuário</Text>
      <FlatList
  data={messages}
  keyExtractor={(item) => item.id.toString()}
  renderItem={({ item }) => (
    <View style={[styles.cardContainer, { backgroundColor: item.color }]}>
      <Text style={styles.cardText}>
        {item.box ? (
          `Caixinha: ${item.expense} - ${item.operation === 'mais' ? '➕' : '➖'} ${item.value}`
        ) : (
          `${item.expense} - ${item.value} - ${item.status === 'Pago' ? '✅ Pago' : '❌ Não Pago'} - Categoria: ${item.category}`
        )}
      </Text>
    </View>
  )}
  horizontal={true} // Scroll horizontal
  showsHorizontalScrollIndicator={false} // Esconde a barra de rolagem
  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
/>



      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          {createChart.map((slice, index) => (
            <Circle
              key={index}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={slice.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${(slice.percentage / 100) * circumference - gap}, ${circumference}`}
              strokeDashoffset={-slice.offset}
              fill="transparent"
              strokeLinecap="round"
            />
          ))}
        </G>

        {/* Mostra o valor total no centro */}
        <SvgText
          x="50%"
          y="50%"
          textAnchor="middle"
          fontSize="16"
          alignmentBaseline="middle"
          fill="#333"
          fontWeight="bold"
        >
          {totalValue.toFixed(2)}
        </SvgText>

        {/* Mostra as porcentagens no centro dos segmentos */}
        {createChart.map((slice, index) => {
          const startAngle = slice.offset / circumference;
          const endAngle = startAngle + slice.percentage / 100;
          const middleAngle = (startAngle + endAngle) / 2;

          const x =
            size / 2 +
            radius * 0.7 * Math.cos(2 * Math.PI * middleAngle);
          const y =
            size / 2 +
            radius * 0.7 * Math.sin(2 * Math.PI * middleAngle);

          return (
            <SvgText
              key={`label-${index}`}
              x={x}
              y={y}
              textAnchor="middle"
              fontSize="10"
              alignmentBaseline="middle"
              fill="#333"
            >
              {`${slice.percentage}%`}
            </SvgText>
          );
        })}
      </Svg>
      <StatusBar style="auto" />
    </View>


  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  messageContainer: {
    marginBottom: 10,
    padding: 10,
    backgroundColor: '#f8f8f8',
    borderRadius: 5,
  },
  messageText: {
    fontSize: 16,
  },
  cardContainer: {
    width: 250, // Largura do cartão
    height: 150, // Altura do cartão
    margin: 10, // Espaçamento entre os cartões
    borderRadius: 12, // Bordas arredondadas
    padding: 15, // Espaçamento interno do cartão
    justifyContent: 'center', // Alinhamento central
    alignItems: 'center', // Alinhamento central
    elevation: 5, // Sombra no Android
    shadowColor: '#000', // Sombra no iOS
    shadowOffset: { width: 0, height: 2 }, // Sombra no iOS
    shadowOpacity: 0.2, // Intensidade da sombra no iOS
    shadowRadius: 3.5, // Raio da sombra no iOS
  },
  cardText: {
    fontSize: 16,
    color: '#FFFFFF',
    textAlign: 'center', // Centraliza o texto
  },

});
