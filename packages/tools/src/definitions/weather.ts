import type { Tool, ToolResult } from '@harness/shared';

// 天气查询工具定义
export const weatherTool: Tool = {
  name: 'weather',
  description: '查询指定城市的当前天气信息。返回温度、湿度、天气状况等。',
  inputSchema: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: '城市名称，例如 "北京"、"上海"、"New York"',
      },
      unit: {
        type: 'string',
        enum: ['celsius', 'fahrenheit'],
        description: '温度单位，默认为摄氏度',
      },
    },
    required: ['city'],
  },
};

// 模拟天气数据
const mockWeatherData: Record<string, { temp: number; humidity: number; condition: string }> = {
  北京: { temp: 22, humidity: 45, condition: '晴' },
  上海: { temp: 25, humidity: 65, condition: '多云' },
  广州: { temp: 28, humidity: 75, condition: '小雨' },
  深圳: { temp: 27, humidity: 70, condition: '阴' },
  杭州: { temp: 23, humidity: 60, condition: '晴转多云' },
  成都: { temp: 20, humidity: 55, condition: '阴' },
  'new york': { temp: 18, humidity: 50, condition: 'Sunny' },
  london: { temp: 15, humidity: 70, condition: 'Cloudy' },
  tokyo: { temp: 21, humidity: 55, condition: 'Clear' },
};

// 天气查询处理函数
export async function weatherHandler(
  input: Record<string, unknown>
): Promise<ToolResult> {
  const city = input['city'] as string;
  const unit = (input['unit'] as string) ?? 'celsius';

  if (!city) {
    return {
      content: 'Error: city is required',
      isError: true,
    };
  }

  const normalizedCity = city.toLowerCase();
  const data = mockWeatherData[normalizedCity] ?? mockWeatherData[city];

  if (!data) {
    return {
      content: `未找到城市 "${city}" 的天气数据。可用的城市：${Object.keys(mockWeatherData).join('、')}`,
      isError: true,
    };
  }

  const temp =
    unit === 'fahrenheit' ? Math.round((data.temp * 9) / 5 + 32) : data.temp;
  const unitSymbol = unit === 'fahrenheit' ? '°F' : '°C';

  return {
    content: JSON.stringify({
      city,
      temperature: `${temp}${unitSymbol}`,
      humidity: `${data.humidity}%`,
      condition: data.condition,
    }),
  };
}
