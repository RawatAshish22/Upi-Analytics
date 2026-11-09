import axios from "axios";

const apiBaseURL = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const api = axios.create({ baseURL: apiBaseURL });

export async function getKPIs(year?: number, states?: string[]) {
  const params: any = { all_years: year === undefined };
  if (year !== undefined) params.year = year;
  if (states !== undefined) params.states = states.join(",");

  const res = await api.get("/api/kpis", { params });
  return res.data;
}

export async function getYears() {
  const res = await api.get("/api/years");
  return res.data.years;
}

export async function getStates() {
  const res = await api.get("/api/states");
  return res.data.states;
}

export async function getTopStates(year?: number, states?: string[], limit = 10) {
  const params: any = { all_years: year === undefined };
  if (year !== undefined) params.year = year;
  if (states !== undefined) params.states = states.join(",");
  params.limit = limit;

  const res = await api.get("/api/top-states", { params });
  return res.data.data;
}

export async function getTrends(year?: number, states?: string[]) {
  const params: any = { all_years: year === undefined };
  if (year !== undefined) params.year = year;
  if (states !== undefined) params.states = states.join(",");

  const res = await api.get("/api/trends", { params });
  return res.data.data;
}

export async function getCategories(year?: number, states?: string[]) {
  const params: any = { all_years: year === undefined };
  if (year !== undefined) params.year = year;
  if (states !== undefined) params.states = states.join(",");

  const res = await api.get("/api/categories", { params });
  return res.data.data;
}

/** Build All-years totals from explicit per-year requests.
 * This avoids relying on a backend's implicit/default year when the user
 * selects All, and makes the aggregate independent of the last year clicked.
 */
export async function getAllYearsDashboard(years: number[], states?: string[]) {
  const annualData = await Promise.all([...years].sort((a, b) => a - b).map(async (year) => {
    const [kpis, topStates, trends, categories] = await Promise.all([
      getKPIs(year, states),
      getTopStates(year, states, 36),
      getTrends(year, states),
      getCategories(year, states),
    ]);
    return { year, kpis, topStates, trends, categories };
  }));

  const stateTotals = new Map<string, number>();
  const categoryTotals = new Map<string, { transactions: number; amount: number }>();
  for (const yearData of annualData) {
    for (const row of yearData.topStates) {
      stateTotals.set(row.state, (stateTotals.get(row.state) ?? 0) + Number(row.transactions || 0));
    }
    for (const row of yearData.categories) {
      const total = categoryTotals.get(row.category) ?? { transactions: 0, amount: 0 };
      total.transactions += Number(row.transactions || 0);
      total.amount += Number(row.amount || 0);
      categoryTotals.set(row.category, total);
    }
  }

  const yearlyKpis = annualData.map(({ kpis }) => kpis);
  const totalTransactions = yearlyKpis.reduce((sum, item) => sum + Number(item.total_transactions || 0), 0);
  const leadersByYear = annualData.map(({ year, topStates }) => ({ year, state: topStates[0]?.state }));
  const overallLeader = [...stateTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const latestYearData = annualData[annualData.length - 1];
  const firstYearLeader = leadersByYear.find((item) => item.year === 2021)?.state;
  const latestYear = latestYearData?.year;
  const ticketSize = (kpis: any) => Number(kpis?.total_transactions)
    ? Number(kpis.total_amount_crore) * 10_000_000 / Number(kpis.total_transactions)
    : 0;
  const ticket2021 = ticketSize(annualData.find((item) => item.year === 2021)?.kpis);
  const latestTicket = ticketSize(latestYearData?.kpis);
  const ticketDecline = ticket2021 ? (1 - latestTicket / ticket2021) * 100 : 0;
  const latestLeadYear = leadersByYear.find(({ year }) => leadersByYear
    .filter((item) => item.year >= year)
    .every((item) => item.state === overallLeader))?.year ?? latestYear;
  const topFiveShare = totalTransactions
    ? [...stateTotals.values()].sort((a, b) => b - a).slice(0, 5).reduce((sum, value) => sum + value, 0) / totalTransactions * 100
    : 0;
  const selectedLabel = states ? " among the selected states" : "";
  const findings = [
    { label: "Growth", text: `Average ticket size fell ${ticketDecline.toFixed(1)}% from 2021 to ${latestYear}${selectedLabel}.`, highlight: `${ticketDecline.toFixed(1)}%`, delta: -ticketDecline },
    { label: "Leadership", text: `${firstYearLeader ?? "The leading state"} led in 2021; ${overallLeader ?? "No state"} leads overall and has held the annual lead since ${latestLeadYear}${selectedLabel}.`, highlight: `${firstYearLeader ?? "The leading state"} led in 2021`, delta: null },
    { label: "Concentration", text: `The top five states hold ${topFiveShare.toFixed(1)}% of transaction volume${selectedLabel}.`, highlight: `${topFiveShare.toFixed(1)}%`, delta: null },
  ];

  return {
    kpis: {
      total_transactions: totalTransactions,
      total_amount_crore: yearlyKpis.reduce((sum, item) => sum + Number(item.total_amount_crore || 0), 0),
      states_covered: Math.max(0, ...yearlyKpis.map((item) => Number(item.states_covered || 0))),
      regions_covered: Math.max(0, ...yearlyKpis.map((item) => Number(item.regions_covered || 0))),
      quarterly_transactions: annualData.flatMap(({ kpis }) => kpis.quarterly_transactions || []),
      quarterly_amount_crore: annualData.flatMap(({ kpis }) => kpis.quarterly_amount_crore || []),
      quarterly_states_covered: annualData.flatMap(({ kpis }) => kpis.quarterly_states_covered || []),
    },
    topStates: [...stateTotals.entries()]
      .map(([state, transactions]) => ({ state, transactions }))
      .sort((a, b) => b.transactions - a.transactions),
    trends: annualData.flatMap(({ trends }) => trends),
    categories: [...categoryTotals.entries()]
      .map(([category, totals]) => ({ category, ...totals }))
      .sort((a, b) => b.transactions - a.transactions),
    findings: {
      scope: "all",
      ticket_year: latestYear,
      latest_ticket: Math.round(latestTicket),
      findings,
    },
  };
}

export async function getInsights(year?: number, states?: string[]) {
  const params: any = { all_years: year === undefined };
  if (year !== undefined) params.year = year;
  if (states !== undefined) params.states = states.join(",");
  const res = await api.get("/api/insights", { params });
  return res.data;
}
export type CopilotChart = {
  type: "bar" | "pie" | "line" | "area";
  title: string;
  data: Record<string, string | number>[];
  valueKey?: string;
  labelKey?: string;
  valueFormat?: "transactions" | "rupees";
  valueLabel?: string;
  series?: { key: string; label: string; color: string }[];
  note?: string | null;
};

export type CopilotResponse = {
  answer: string;
  chart?: CopilotChart;
};

export async function askCopilot(
  question: string,
  year?: number,
  states?: string[],
  onChunk?: (chunk: string) => void,
): Promise<CopilotResponse> {
  const response = await fetch(`${api.defaults.baseURL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, year, states }),
  });

  if (!response.ok) throw new Error(`Copilot request failed (${response.status})`);
  if (response.headers.get("content-type")?.includes("application/json")) {
    const data = await response.json();
    onChunk?.(data.answer);
    return { answer: data.answer ?? "", chart: data.chart };
  }

  if (!response.body) throw new Error("Streaming response is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let answer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    answer += chunk;
    onChunk?.(chunk);
  }
  const finalChunk = decoder.decode();
  if (finalChunk) {
    answer += finalChunk;
    onChunk?.(finalChunk);
  }
  return { answer };
}
