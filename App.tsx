import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, FlatList, RefreshControl } from 'react-native';
import axios from 'axios';
import { Picker } from '@react-native-picker/picker';
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
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [totalsByCategory, setTotalsByCategory] = useState<{ [key: string]: number }>({});


// Função para analisar o texto da mensagem
// Função para analisar o texto da mensagem
const parseMessageDetails = (message: string): { expense?: string; value?: number; status?: string; category?: string; box?: boolean; operation?: 'mais' | 'menos' } | null => {
  console.log('Analisando mensagem:', message); // Log para ver a mensagem original
  
  if (message.toLowerCase().includes('deletar')) {
    console.log('Mensagem ignorada (deletar detectado).');
    return null;  // Ignora a mensagem
  }

  // Verificar se é uma "caixinha"
  const caixaRegex = /Caixinha:\s*([a-zA-Z\s]+)\s*-\s*(mais|menos)\s*(\d+(\.\d+)?)/i;
  const caixaMatch = message.match(caixaRegex);

  if (caixaMatch) {
    console.log('Mensagem de caixinha encontrada:', caixaMatch); // Log para ver os detalhes da caixinha
    return {
      box: true,
      expense: caixaMatch[1].trim(),
      value: parseFloat(caixaMatch[3]),
      operation: caixaMatch[2] as 'mais' | 'menos',  // Assegura que a operação seja "mais" ou "menos"
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
}


  // Função para buscar mensagens do Telegram
  const fetchMessages = async () => {
    try {
      const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`;
      const response = await axios.get(url);
      console.log(url)
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



  const size = 200; // Tamanho total do gráfico (diâmetro)
  const strokeWidth = 20; // Largura do traço
  const radius = (size - strokeWidth) / 2; // Raio do círculo
  const circumference = 2 * Math.PI * radius; // Comprimento do círculo
  const gap = 2; // Espaço entre os segmentos

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
        calculateTotalsByCategory(messages); // Calcula os totais por categoria
      }
    } catch (error) {
      console.error('Erro geral ao buscar mensagens do banco de dados:', error);
    }
  };

  // Função para calcular os totais por categoria
  const calculateTotalsByCategory = (messages: any[]) => {
    const totals: { [key: string]: number } = {};

    messages.forEach((message) => {
      if (message.value) {
        // Somar o total por categoria
        if (totals[message.category]) {
          totals[message.category] += message.value;
        } else {
          totals[message.category] = message.value;
        }
      }
    });

    setTotalsByCategory(totals);
  };

  useEffect(() => {
    fetchMessagesFromDatabase(); // Chama a função para buscar os dados do banco
  }, []); // O array vazio significa que o efeito só será executado uma vez, após o carregamento inicial.

  const totalValue = Object.values(totalsByCategory).reduce((sum, value) => sum + value, 0);

  const createChart = Object.keys(totalsByCategory).map((category, index) => {
    const value = totalsByCategory[category];
    const percentage = (value / totalValue) * 100; // Percentual de cada despesa
    const offset =
      Object.keys(totalsByCategory)
        .slice(0, index)
        .reduce((sum, cat) => sum + (totalsByCategory[cat] / totalValue) * circumference, 0); // Deslocamento do segmento

    return {
      expense: category,
      value: value,
      color: generateColorForExpense(category),
      percentage: percentage.toFixed(2),
      offset: offset + gap * index, // Ajuste para o espaço entre os segmentos
    };
  });
  const filterMessages = () => {
    return messages.filter((message) =>
      filterCategory ? message.category === filterCategory : true
    );
  };


  return (
    <View style={styles.container}>
      <Text style={styles.title}>Últimos Registros</Text>

      {/* Componente de seleção para filtro de categoria */}
      <Picker
        selectedValue={filterCategory}
        style={styles.picker}
        onValueChange={(itemValue) => setFilterCategory(itemValue)}
      >
        <Picker.Item label="Todas as Categorias" value="" />
        {Object.keys(totalsByCategory).map((category) => (
          <Picker.Item key={category} label={category} value={category} />
        ))}
      </Picker>

      <FlatList
        data={filterMessages()}
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
        horizontal={true}
        showsHorizontalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />

      {/* Seção de Análise de Gastos Mensais */}
      <View style={styles.analysisContainer}>
        <Text style={styles.analysisTitle}>Análise de Gastos Mensais</Text>
        {/* Aqui você pode adicionar gráficos ou comparativos de gastos */}
        <Text>Total Geral: {totalValue.toFixed(2)}</Text>
        <Text>Total por Categoria:</Text>
        {Object.entries(totalsByCategory).map(([category, value]) => (
          <Text key={category}>
            {category}: {value.toFixed(2)} ({((value / totalValue) * 100).toFixed(2)}%)
          </Text>
        ))}
      </View>

      {/* Seção de Caixinhas */}
      <View style={styles.boxContainer}>
        <Text style={styles.boxTitle}>Caixinhas</Text>
        {messages.filter(message => message.box).map((item) => (
          <Text key={item.id}>
            {item.expense} - {item.value} - {item.operation === 'mais' ? '➕' : '➖'}
          </Text>
        ))}
      </View>

      {/* Gráfico de Pizza */}
      <View style={styles.chartContainer}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {createChart.map((item, index) => (
            <Circle
              key={index}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={item.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${(item.value / totalValue) * circumference} ${circumference}`}
              strokeDashoffset={item.offset}
              fill="transparent"
            />
          ))}
          {createChart.map((item, index) => {
            const angle = ((item.percentage / 100) * 360) / 2;
            const x = size / 2 + (radius + 10) * Math.cos((angle * Math.PI) / 180);
            const y = size / 2 + (radius + 10) * Math.sin((angle * Math.PI) / 180);

            return (
              <SvgText
                key={index}
                x={x}
                y={y}
                fontSize="12"
                textAnchor="middle"
                fill={item.color}
              >
                {item.percentage}%
              </SvgText>
            );
          })}
        </Svg>

        {/* Total Geral no centro */}
        <Text
          style={{
            position: 'absolute',
            fontSize: 24,
            fontWeight: 'bold',
            color: '#000',
            textAlign: 'center',
            top: size / 2 - 12,
            left: size / 2 - 30,
          }}
        >
          {totalValue.toFixed(2)}
        </Text>
      </View>

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
  analysisContainer: {
    marginVertical: 20,
    padding: 10,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    width: '90%',
  },
  analysisTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  boxContainer: {
    marginVertical: 20,
    padding: 10,
    backgroundColor: '#e0f7fa',
    borderRadius: 10,
    width: '90%',
  },
  boxTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  chartContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 20,
  },
  cardContainer: {
    width: 250,
    height: 150,
    margin: 10,
    borderRadius: 12,
    padding: 15,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3.5,
  },
  cardText: {
    fontSize: 16,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});