"use client";

import { useEffect, useLayoutEffect, useState, useRef } from "react";
import type { FocusEvent, MouseEvent } from "react";
import {
  getAllYearsDashboard,
  getKPIs,
  getYears,
  getStates,
  getTopStates,
  getTrends,
  getCategories,
  getInsights,
  askCopilot,
} from "../lib/api";
import type { CopilotChart } from "../lib/api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  LabelList,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Bot,
  ChevronDown,
  Moon,
  Search,
  Send,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { states as indiaStateFeatures } from "vardhan-maps/data";
import { featurePaths, fitProjection } from "vardhan-maps/svg";

type ChatMessage = { role: "user" | "assistant"; content: string; chart?: CopilotChart };

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-lg border border-[var(--hairline)] bg-[var(--surface-raised)] ${className}`} />
  );
}

function AnimatedValue({ value, format }: { value: number; format: (n: number) => string }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const started = performance.now();
    const duration = 850;
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min((now - started) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(value * eased);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{format(displayValue)}</>;
}

function compactTransactions(value: number) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return Math.round(value).toLocaleString("en-IN");
}

function formatCopilotChartValue(chart: CopilotChart, value: number) {
  return chart.valueFormat === "rupees"
    ? `₹${Math.round(value).toLocaleString("en-IN")}`
    : compactTransactions(value);
}

function compactAmount(valueInCrore: number) {
  const rupees = valueInCrore * 10_000_000;
  if (rupees >= 1e12) return `₹${(rupees / 1e12).toFixed(2)}T`;
  if (rupees >= 1e9) return `₹${(rupees / 1e9).toFixed(1)}B`;
  if (rupees >= 1e6) return `₹${(rupees / 1e6).toFixed(1)}M`;
  return `₹${Math.round(rupees).toLocaleString("en-IN")}`;
}

function compactRupees(value: number) {
  if (value >= 1e12) return `₹${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `₹${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `₹${(value / 1e6).toFixed(1)}M`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function DashboardDataTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  const title = point.name ?? label ?? "";
  return (
    <div className="state-map-tooltip">
      <div className="state-map-tooltip-content">
        <span className="state-map-tooltip-name">{title}</span>
        <span className="state-map-tooltip-value">{compactTransactions(Number(point.value))} <small>transactions</small></span>
      </div>
    </div>
  );
}

function formatInline(text: string) {
  const compactLargeNumbers = (value: string) => value.replace(/\b(?:\d{1,3}(?:,\d{3})+|\d{7,})\b/g, (raw) => {
    const number = Number(raw.replace(/,/g, ""));
    return number >= 1e6 ? compactTransactions(number) : raw;
  });
  return text
    .split(/(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|`[^`]+`)/g)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={index}>{compactLargeNumbers(part.slice(2, -2))}</strong>;
      }
      if (part.startsWith("__") && part.endsWith("__")) {
        return <strong key={index}>{compactLargeNumbers(part.slice(2, -2))}</strong>;
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return <em key={index}>{compactLargeNumbers(part.slice(1, -1))}</em>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code
            key={index}
            className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] dark:bg-slate-700"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return compactLargeNumbers(part);
    });
}

function FormattedAnswer({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let paragraph: string[] = [];
  let index = 0;
  let blockId = 0;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(
        <p key={`p-${blockId++}`}>
          {formatInline(paragraph.join(" "))}
        </p>
      );
      paragraph = [];
    }
  };

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      flushParagraph();
      index += 1;
      continue;
    }

    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push(
        <h3 key={`h-${blockId++}`} className="font-semibold text-slate-900 dark:text-white">
          {formatInline(heading[1])}
        </h3>
      );
      index += 1;
      continue;
    }

    if (line.startsWith("|") && index + 1 < lines.length && /^\s*\|?[\s:|-]+\|\s*$/.test(lines[index + 1])) {
      flushParagraph();
      const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
      const headers = cells(line);
      const numericColumns = headers.map((header) => /transaction|amount|value|total|count/i.test(header));
      const displayCell = (value: string) => {
        const currency = value.startsWith("₹");
        const numeric = Number(value.replace(/[₹,\s]/g, ""));
        if (!Number.isFinite(numeric) || numeric < 100_000) return value;
        return currency ? compactRupees(numeric) : compactTransactions(numeric);
      };
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(cells(lines[index]));
        index += 1;
      }
      blocks.push(
        <div key={`table-${blockId++}`} className="thin-scrollbar overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="min-w-full border-collapse text-left text-xs">
            <thead className="bg-white/[0.05] text-[var(--accent)]"><tr>{headers.map((cell, cellIndex) => <th key={cellIndex} className={`px-3 py-2 font-semibold ${numericColumns[cellIndex] ? "text-right" : "text-left"}`}>{formatInline(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((cellsInRow, rowIndex) => <tr key={rowIndex} className="border-t border-white/[0.06] text-[#C7CDE0]">{cellsInRow.map((cell, cellIndex) => <td key={cellIndex} className={`px-3 py-2 tabular-nums ${numericColumns[cellIndex] ? "text-right" : "text-left"}`}>{formatInline(displayCell(cell))}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }

    const listItem = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      const ordered = /^\d+[.)]/.test(line);
      const items = [];
      while (index < lines.length) {
        const current = lines[index].trim().match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
        if (!current || /^\d+[.)]/.test(lines[index].trim()) !== ordered) break;
        items.push(<li key={index}>{formatInline(current[1])}</li>);
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List
          key={`list-${blockId++}`}
          className={ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}
        >
          {items}
        </List>
      );
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return <div className="space-y-2">{blocks}</div>;
}

function normalizeStateName(name: string) {
  const normalized = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");
  const aliases: Record<string, string> = {
    orissa: "odisha", uttaranchal: "uttarakhand", pondicherry: "puducherry",
    nctofdelhi: "delhi", delhinationalcapitalterritory: "delhi",
    dadraandnagarhaveli: "dadranagarhavelidamananddiu",
    damananddiu: "dadranagarhavelidamananddiu",
  };
  return aliases[normalized] ?? normalized;
}

const INDIA_MAP_WIDTH = 420;
const INDIA_MAP_HEIGHT = 470;
type IndiaStatePath = { d: string; properties: { name: string; code?: string } };
function getIndiaBounds(): [number, number, number, number] {
  const points: number[][] = [];
  const visit = (coordinates: unknown) => {
    if (!Array.isArray(coordinates)) return;
    if (coordinates.length >= 2 && typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
      points.push(coordinates as number[]);
      return;
    }
    coordinates.forEach(visit);
  };
  (indiaStateFeatures.features as any[]).forEach((feature) => visit(feature.geometry.coordinates));
  return [
    Math.min(...points.map(([longitude]) => longitude)),
    Math.min(...points.map(([, latitude]) => latitude)),
    Math.max(...points.map(([longitude]) => longitude)),
    Math.max(...points.map(([, latitude]) => latitude)),
  ];
}
const INDIA_PROJECTION = fitProjection(getIndiaBounds(), INDIA_MAP_WIDTH, INDIA_MAP_HEIGHT, 14);
const INDIA_STATE_PATHS = featurePaths(indiaStateFeatures.features, INDIA_PROJECTION) as IndiaStatePath[];

function formatMapTransactions(value: number) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return Math.round(value).toLocaleString("en-IN");
}

function IndiaActivityMap({ data, darkMode }: { data: any[]; darkMode: boolean }) {
  const [hoveredState, setHoveredState] = useState<{ name: string; transactions: number; x: number; y: number } | null>(null);
  const transactionByState = new Map(data.map((item) => [normalizeStateName(item.state), item.transactions]));
  const max = Math.max(...data.map((item) => item.transactions), 1);
  const stops = darkMode
    ? ["#17345d", "#1e4778", "#2c6399", "#3e82bd", "#66b6d4"]
    : ["#dceaff", "#bdd6fa", "#91b8ee", "#5e91dc", "#1d4ed8"];
  const stateFill = (name: string) => {
    const transactions = transactionByState.get(normalizeStateName(name));
    if (transactions === undefined) return darkMode ? "#111b2e" : "#e8eff8";
    const ratio = transactions / max;
    const index = Math.min(stops.length - 1, Math.floor(ratio * (stops.length - 1)));
    return stops[index];
  };
  const showStateDetails = (name: string, event: MouseEvent<SVGPathElement>) => {
    const transactions = transactionByState.get(normalizeStateName(name)) ?? 0;
    setHoveredState({
      name,
      transactions,
      x: Math.min(event.clientX + 14, window.innerWidth - 220),
      y: Math.min(event.clientY + 14, window.innerHeight - 78),
    });
  };
  const showFocusedStateDetails = (name: string, event: FocusEvent<SVGPathElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const transactions = transactionByState.get(normalizeStateName(name)) ?? 0;
    setHoveredState({ name, transactions, x: Math.min(bounds.left + bounds.width / 2 + 10, window.innerWidth - 220), y: Math.min(bounds.top + bounds.height / 2 + 10, window.innerHeight - 78) });
  };

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="relative min-h-0 w-full flex-1 px-2">
        <svg viewBox={`0 0 ${INDIA_MAP_WIDTH} ${INDIA_MAP_HEIGHT}`} className="india-boundary-map" role="img" aria-label="India states shaded by transaction volume">
          {INDIA_STATE_PATHS.map(({ d, properties }) => {
            const value = transactionByState.get(normalizeStateName(properties.name)) ?? 0;
            return <path
              key={properties.name}
              d={d}
              fill={stateFill(properties.name)}
              stroke={darkMode ? "rgba(255,255,255,0.18)" : "rgba(71,85,105,0.28)"}
              strokeWidth={1.5}
              strokeLinejoin="round"
              className="cursor-pointer transition-colors duration-200 focus:outline-none"
              onMouseMove={(event) => showStateDetails(properties.name, event)}
              onMouseLeave={() => setHoveredState(null)}
              onFocus={(event) => showFocusedStateDetails(properties.name, event)}
              onBlur={() => setHoveredState(null)}
              tabIndex={0}
              aria-label={`${properties.name}: ${formatMapTransactions(value)} transactions`}
            ><title>{`${properties.name}: ${formatMapTransactions(value)} transactions`}</title></path>;
          })}
        </svg>
        {hoveredState && <div className="state-map-tooltip" style={{ left: hoveredState.x, top: hoveredState.y }}>
          <div className="state-map-tooltip-content">
            <span className="state-map-tooltip-name">{hoveredState.name}</span>
            <span className="state-map-tooltip-value">{formatMapTransactions(hoveredState.transactions)} <small>transactions</small></span>
          </div>
        </div>}
      </div>
      <div className="mt-2 flex w-full items-center justify-between px-2 text-[10px] text-[#8B94B3]">
        <span>Lower volume</span>
        <span className="flex items-center gap-1" aria-hidden="true">{stops.map((color) => <i key={color} className="h-2.5 w-5 first:rounded-l-full last:rounded-r-full" style={{ backgroundColor: color }} />)}</span>
        <span>Higher volume</span>
      </div>
      <p className="mt-1.5 text-center text-[9px] text-[#8B94B3]">Hover any state for its transaction total.</p>
    </div>
  );
}

const COLORS = Array.from({ length: 7 }, (_, index) => `var(--series-${index + 1})`);
const REGIONS: Record<string, string[]> = {
  North: ["Chandigarh", "Delhi", "Haryana", "Himachal Pradesh", "Jammu & Kashmir", "Ladakh", "Punjab", "Rajasthan", "Uttar Pradesh", "Uttarakhand"],
  South: ["Andhra Pradesh", "Karnataka", "Kerala", "Puducherry", "Tamil Nadu", "Telangana", "Lakshadweep"],
  East: ["Bihar", "Jharkhand", "Odisha", "West Bengal", "Andaman & Nicobar Islands"],
  West: ["Goa", "Gujarat", "Maharashtra", "Dadra & Nagar Haveli & Daman & Diu"],
  Central: ["Chhattisgarh", "Madhya Pradesh", "Uttar Pradesh"],
  "North-East": ["Arunachal Pradesh", "Assam", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Sikkim", "Tripura"],
};
const COPILOT_SUGGESTIONS = [
  "Which state has the most transactions overall, across all years?",
  "Which state has the most transactions this year?",
  "How have transactions changed each quarter?",
  "Which category has the most transactions overall?",
];

export default function Home() {
  const [kpis, setKpis] = useState({
    total_transactions: 0,
    total_amount_crore: 0,
    states_covered: 0,
    regions_covered: 0,
    quarterly_transactions: [] as number[],
    quarterly_amount_crore: [] as number[],
    quarterly_states_covered: [] as number[],
  });
  const [years, setYears] = useState<number[]>([]);
  const [allStates, setAllStates] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | undefined>();
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [topStates, setTopStates] = useState<any[]>([]);
  const [trends, setTrends] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [findings, setFindings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [stateSearch, setStateSearch] = useState("");
  const [showStatePicker, setShowStatePicker] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [responseStarted, setResponseStarted] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const dashboardRequestId = useRef(0);

  // Load dark mode preference
  useEffect(() => {
    const saved = localStorage.getItem("darkMode");
    const shouldUseDark = saved !== "false";
    setDarkMode(shouldUseDark);
    if (shouldUseDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem("darkMode", String(newMode));

    if (newMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  // Load years and states
  useEffect(() => {
    async function loadFilters() {
      try {
        const [yearsData, statesData] = await Promise.all([
          getYears(),
          getStates(),
        ]);
        setYears(yearsData);
        setAllStates(statesData);
        setSelectedStates(statesData);
        // Keep the dashboard in All years mode on first load. Selecting
        // yearsData[0] here silently overrides the All tab and makes the
        // initial data disagree with the visible filter.
      } catch (error) {
        console.error(error);
      }
    }
    loadFilters();
  }, []);

  // Load dashboard data
  useEffect(() => {
    async function loadDashboardData() {
      if (years.length === 0) return;
      const requestId = ++dashboardRequestId.current;
      setLoading(true);
      try {
        const statesParam =
          selectedStates.length === allStates.length
            ? undefined
            : selectedStates;

        const dashboardPromise = selectedYear === undefined
          ? getAllYearsDashboard(years, statesParam)
          : Promise.all([
              getKPIs(selectedYear, statesParam),
              getTopStates(selectedYear, statesParam, 36),
              getTrends(selectedYear, statesParam),
              getCategories(selectedYear, statesParam),
            ]).then(([kpis, topStates, trends, categories]) => ({ kpis, topStates, trends, categories, findings: undefined }));
        const [dashboardData, findingsData] = await Promise.all([
          dashboardPromise,
          selectedYear === undefined
            ? dashboardPromise.then((data) => data.findings)
            : getInsights(selectedYear, statesParam),
        ]);

        if (requestId !== dashboardRequestId.current) return;
        setKpis(dashboardData.kpis);
        setTopStates(dashboardData.topStates);
        setTrends(dashboardData.trends);
        setCategories(dashboardData.categories);
        setFindings(findingsData);
      } catch (error) {
        console.error(error);
      } finally {
        if (requestId === dashboardRequestId.current) setLoading(false);
      }
    }
    loadDashboardData();
  }, [selectedYear, selectedStates, allStates, years]);

  useLayoutEffect(() => {
    dashboardRequestId.current += 1;
    setLoading(true);
  }, [selectedYear, selectedStates]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (question = input) => {
    if (!question.trim() || chatLoading) return;
    const userMessage = question.trim();
    setInput("");
    setResponseStarted(false);
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setChatLoading(true);

    try {
      const statesParam =
        selectedStates.length === allStates.length
          ? undefined
          : selectedStates;
      const response = await askCopilot(userMessage, selectedYear, statesParam, (chunk) => {
        if (!chunk) return;
        setResponseStarted(true);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + chunk };
          } else {
            next.push({ role: "assistant", content: chunk });
          }
          return next;
        });
      });
      if (response.chart) {
        setMessages((prev) => {
          const next = [...prev];
          const assistantIndex = next.map((message) => message.role).lastIndexOf("assistant");
          if (assistantIndex >= 0) next[assistantIndex] = { ...next[assistantIndex], chart: response.chart };
          return next;
        });
      }
      if (!response.answer) {
        setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I could not generate an answer." }]);
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "user") {
          next.push({ role: "assistant", content: "Sorry, something went wrong." });
        } else {
          next.push({ role: "assistant", content: "The connection ended before the answer finished." });
        }
        return next;
      });
    } finally {
      setChatLoading(false);
      setResponseStarted(false);
    }
  };

  const toggleState = (state: string) => {
    if (selectedStates.includes(state)) {
      setSelectedStates(selectedStates.filter((s) => s !== state));
    } else {
      setSelectedStates([...selectedStates, state]);
    }
  };

  const setRegion = (region: string) => {
    const regionStates = REGIONS[region] ?? [];
    const included = regionStates.filter((state) => allStates.includes(state));
    const alreadySelected = included.every((state) => selectedStates.includes(state));
    setSelectedStates(alreadySelected
      ? selectedStates.filter((state) => !included.includes(state))
      : [...new Set([...selectedStates, ...included])]
    );
  };

  // Insights
  const topStateName = topStates.length > 0 ? topStates[0].state : "-";
  const topStateValue =
    topStates.length > 0
      ? (topStates[0].transactions / 1e9).toFixed(2) + "B"
      : "-";
  const dominantCategory =
    categories.length > 0 ? categories[0].category : "-";
  const averageTicket = kpis.total_transactions > 0
    ? Math.round((kpis.total_amount_crore * 10_000_000) / kpis.total_transactions)
    : 0;
  const topThree = topStates.slice(0, 3);
  const transactionsDelta = kpis.quarterly_transactions ?? [];
  const amountDelta = kpis.quarterly_amount_crore ?? [];
  const getQuarterChange = (series: number[]) => {
    if (series.length < 2 || !series[series.length - 2]) return null;
    return ((series[series.length - 1] - series[series.length - 2]) / series[series.length - 2]) * 100;
  };
  const quarterComparison = trends.length >= 2
    ? `${trends[trends.length - 1].period.split(" - ").pop()} vs ${trends[trends.length - 2].period.split(" - ").pop()}`
    : "vs prior quarter";
  const visibleStates = allStates.filter((state) => state.toLowerCase().includes(stateSearch.toLowerCase()));
  const trendMax = Math.max(...trends.map((point) => point.transactions), 0);
  const trendStep = 10_000_000_000;
  const trendTicks = Array.from({ length: Math.max(2, Math.ceil(trendMax / trendStep) + 1) }, (_, index) => index * trendStep);
  const annualTransactions = new Map<number, number>();
  trends.forEach((point) => { const year = Number(String(point.period).slice(0, 4)); annualTransactions.set(year, (annualTransactions.get(year) ?? 0) + point.transactions); });
  const latestDataYear = Math.max(...annualTransactions.keys());
  const latestFullYear = latestDataYear > 2018 ? latestDataYear - (trends.some((point) => point.period.startsWith(`${latestDataYear} - Q4`)) ? 0 : 1) : 0;
  const priorFullYear = latestFullYear - 1;
  const annualYoY = latestFullYear && annualTransactions.has(priorFullYear)
    ? ((annualTransactions.get(latestFullYear)! - annualTransactions.get(priorFullYear)!) / annualTransactions.get(priorFullYear)!) * 100
    : null;

  return (
    <div className="dashboard-shell">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 sm:py-5">
          <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="brand-mark flex h-10 w-10 items-center justify-center rounded-lg text-lg font-medium text-white">₹</div>
              <div>
                <h1 className="text-2xl font-medium sm:text-[28px]">
                  UPI Payments Analytics
                </h1>
                <p className="mt-1 text-sm text-[#8B94B3]">
                  PhonePe Pulse <span className="mx-1">·</span> India transaction intelligence
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="year-switcher thin-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border p-1">
                <button
                  type="button"
                  onClick={() => setSelectedYear(undefined)}
                  aria-pressed={selectedYear === undefined}
                  className={`year-option shrink-0 rounded-md px-3 py-2 text-xs transition-colors ${selectedYear === undefined ? "active-year" : ""}`}
                >
                  All
                </button>
                {[...years].sort((a, b) => a - b).map((year) => (
                  <button
                    key={year}
                    type="button"
                    onClick={() => setSelectedYear(year)}
                    aria-pressed={selectedYear === year}
                    className={`year-option shrink-0 rounded-md px-3 py-2 text-xs tabular-nums transition-colors ${selectedYear === year ? "active-year" : ""}`}
                  >
                    {year}
                  </button>
                ))}
              </div>
              <button
                onClick={toggleDarkMode}
                className="theme-toggle inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors"
                title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              >
                {darkMode ? <Sun size={15} /> : <Moon size={15} />}
                <span className="hidden sm:inline">{darkMode ? "Light" : "Dark"}</span>
              </button>
            </div>
          </div>

          {/* State Filter */}
          <div className="state-filter-panel relative rounded-xl border p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[#8B94B3]">Filter regions</span>
                {selectedStates.length === allStates.length ? <span className="region-summary rounded-md border px-2.5 py-1 text-xs">28 states · 8 UTs</span> : selectedStates.slice(0, 8).map((state) => (
                  <button key={state} onClick={() => toggleState(state)} className="selected-state-pill rounded-md border px-2.5 py-1 text-xs transition-colors">
                    {state} <span className="chip-remove ml-1">×</span>
                  </button>
                ))}
                {selectedStates.length < allStates.length && selectedStates.length > 8 && <span className="text-xs text-[#8B94B3]">+{selectedStates.length - 8} more</span>}
                {selectedStates.length === 0 && <span className="text-xs text-[#8B94B3]">No states selected</span>}
              </div>
              <button type="button" onClick={() => setShowStatePicker(!showStatePicker)} aria-expanded={showStatePicker} className="filter-control inline-flex shrink-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors sm:min-w-44">
                {selectedStates.length === allStates.length ? "All 36 regions" : `${selectedStates.length} selected`}
                <ChevronDown size={14} className={`transition-transform ${showStatePicker ? "rotate-180" : ""}`} />
              </button>
            </div>
            {showStatePicker && (
              <div className="state-picker-menu absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-xl border p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8B94B3]" />
                    <input value={stateSearch} onChange={(event) => setStateSearch(event.target.value)} placeholder="Search regions" className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[#737C9D]" />
                  </div>
                  <button onClick={() => setShowStatePicker(false)} aria-label="Close state filter" className="rounded-lg p-2 text-[#8B94B3] hover:bg-white/5"><X size={15} /></button>
                </div>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {Object.keys(REGIONS).map((region) => <button key={region} onClick={() => setRegion(region)} className="rounded-md border px-2.5 py-1 text-xs text-[#8B94B3] transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]">{region}</button>)}
                  <button onClick={() => setSelectedStates(allStates)} className="ml-auto rounded-md px-2.5 py-1 text-xs text-[#8B94B3] hover:bg-black/[0.04] dark:hover:bg-white/[0.05]">Select all</button>
                  <button onClick={() => setSelectedStates([])} className="rounded-md px-2.5 py-1 text-xs text-[#8B94B3] hover:bg-black/[0.04] dark:hover:bg-white/[0.05]">Clear</button>
                </div>
                <div className="thin-scrollbar grid max-h-52 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
                  {visibleStates.map((state) => <button key={state} aria-pressed={selectedStates.includes(state)} onClick={() => toggleState(state)} className="region-option flex items-center rounded-md border border-transparent px-2.5 py-2 text-left text-sm transition-colors"><span className="region-check mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px]">{selectedStates.includes(state) ? "✓" : ""}</span>{state}</button>)}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 sm:space-y-8 sm:px-6 sm:py-9">
        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[
            { label: "Total transactions", value: kpis.total_transactions, full: kpis.total_transactions.toLocaleString("en-IN"), change: selectedYear ? getQuarterChange(transactionsDelta) : null, note: selectedYear ? "Quarter comparison unavailable" : annualYoY === null ? "All-time total" : `YoY ${annualYoY >= 0 ? "+" : ""}${annualYoY.toFixed(1)}% · ${latestFullYear} vs ${priorFullYear}`, format: compactTransactions },
            { label: "Transaction value", value: kpis.total_amount_crore, full: `₹${kpis.total_amount_crore.toLocaleString("en-IN")} crore`, change: selectedYear ? getQuarterChange(amountDelta) : null, note: selectedYear ? `${selectedYear} total transaction value` : "All-years transaction value", format: compactAmount },
            { label: "Regions covered", value: kpis.regions_covered, full: `${kpis.states_covered} states + ${kpis.regions_covered - kpis.states_covered} union territories`, change: null, note: `${kpis.states_covered} states + ${kpis.regions_covered - kpis.states_covered} UTs`, format: (value: number) => Math.round(value).toString() },
          ].map((item) => (
            <div key={item.label} title={item.full} className="glass-card kpi-card min-h-36 p-5 sm:p-6">
              <p className="text-sm text-[#8B94B3]">{item.label}</p>
              {loading ? <Skeleton className="mt-4 h-9 w-36" /> : (
                <p className="mt-3 tabular-nums text-3xl font-medium text-[#E6EAF5] sm:text-[34px]"><AnimatedValue value={item.value} format={item.format} /></p>
              )}
              <div className="mt-3 text-xs" style={{ color: item.change === null ? undefined : item.change >= 0 ? "var(--positive)" : "var(--negative)" }}>
                {item.change === null ? item.note : `${item.change >= 0 ? "▲" : "▼"} ${Math.abs(item.change).toFixed(1)}% · ${quarterComparison}`}
              </div>
            </div>
          ))}
        </div>

        {/* Insight cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { label: "Top state", value: topStateName, detail: loading ? "" : `${topStateValue} transactions` },
            { label: "Dominant category", value: dominantCategory, detail: "Highest transaction share" },
            { label: "Average ticket size", value: averageTicket ? `₹${averageTicket.toLocaleString("en-IN")}` : "—", detail: selectedYear ? "Selected year average" : findings?.latest_ticket ? `${findings.ticket_year}: ₹${Number(findings.latest_ticket).toLocaleString("en-IN")}` : "Transaction value ÷ transaction count" },
          ].map((insight) => (
            <div key={insight.label} className="glass-card p-5 sm:p-6">
              <p className="text-sm text-[#8B94B3]">{insight.label}</p>
              <p className="mt-3 text-xl font-medium text-[#E6EAF5]">{loading ? <span className="text-[#8B94B3]">Loading…</span> : insight.value}</p>
              <p className="mt-1 text-sm text-[#8B94B3]">{insight.detail}</p>
            </div>
          ))}
        </div>

        <section className="glass-card p-4 sm:p-5" aria-label="Key data findings">
          <div className="mb-3"><h2 className="text-sm font-medium text-[#8B94B3]">Data findings · {selectedYear ?? "All years"}</h2></div>
          <div key={`${selectedYear ?? "all"}-${selectedStates.length}`} className="finding-cards grid gap-3 sm:grid-cols-3">
            {(findings?.findings ?? []).map((finding: any) => {
              const [before, after] = finding.text.split(finding.highlight);
              return <article key={finding.label} className="min-h-[76px] rounded-lg bg-black/[0.025] p-4 dark:bg-white/[0.025]">
                <p className="mb-2 text-xs font-medium text-[#8B94B3]">{finding.label}</p>
                <p className="line-clamp-2 text-sm leading-5 text-[#C7CDE0]">{before}<strong className="font-medium text-[#E6EAF5]">{finding.highlight}</strong>{after}</p>
              </article>;
            })}
          </div>
        </section>

        {/* State rankings and India activity */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(300px,0.8fr)]">
          <section className="glass-card flex flex-col p-4 sm:p-6">
            <div className="mb-4 flex items-end justify-between gap-3 sm:mb-6">
              <div>
                <p className="text-sm text-[#8B94B3]">State performance</p>
                <h2 className="mt-1 text-lg font-medium text-[#E6EAF5]">Top 10 by transaction volume</h2>
              </div>
              <span className="text-xs text-[#8B94B3]">{selectedYear ?? "All years"} · transactions</span>
            </div>
            <div className="min-h-[22rem] flex-1 sm:min-h-[25rem]">
              {loading ? <Skeleton className="h-full w-full" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topStates.slice(0, 10)} layout="vertical" margin={{ top: 4, right: 34, bottom: 2, left: 4 }} barCategoryGap={8}>
                    <CartesianGrid stroke="var(--hairline)" horizontal={false} />
                    <XAxis type="number" tickFormatter={(value) => `${(value / 1e9).toFixed(0)}B`} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="state" type="category" width={115} axisLine={false} tickLine={false} tick={({ x, y, payload, index }: any) => <g transform={`translate(${x},${y})`}><text x={-5} y={0} dy={4} textAnchor="end" fill={index === 0 ? "var(--rank-accent)" : "var(--secondary)"} fontSize={12} fontWeight={index === 0 ? 600 : 400}>{`${index + 1}. ${payload.value}`}</text></g>} />
                    <Tooltip
                      cursor={{ fill: "var(--surface-raised)" }}
                      content={({ active, payload, label }: any) => active && payload?.length ? (
                        <div className="state-map-tooltip">
                          <div className="state-map-tooltip-content">
                            <span className="state-map-tooltip-name">{label}</span>
                            <span className="state-map-tooltip-value">{compactTransactions(Number(payload[0].value))} <small>transactions</small></span>
                          </div>
                        </div>
                      ) : null}
                    />
                    <Bar dataKey="transactions" radius={[0, 6, 6, 0]} maxBarSize={20} isAnimationActive>
                      {topStates.slice(0, 10).map((_, index) => <Cell key={index} fill={index === 0 ? "var(--rank-accent)" : "var(--chart-accent)"} />)}
                      <LabelList dataKey="transactions" position="right" formatter={(value: any) => compactTransactions(Number(value))} fill="var(--secondary)" fontSize={12} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          <section className="glass-card p-4 sm:p-6">
            <div className="mb-2">
              <p className="text-sm text-[#8B94B3]">India overview</p>
              <h2 className="mt-1 text-lg font-medium text-[#E6EAF5]">Transaction activity</h2>
            </div>
            <div className="h-[22rem] sm:h-[24rem]">
              {loading ? <Skeleton className="h-full w-full" /> : <IndiaActivityMap data={topStates} darkMode={darkMode} />}
            </div>
            <div className="mt-4 border-t border-white/[0.07] pt-3">
              <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-[#8B94B3]">Top 3 regions</span><span className="text-xs text-[#8B94B3]">transactions</span></div>
              <div className="space-y-1.5">
                {topThree.map((item, index) => <div key={item.state} className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--surface-raised)]"><span className={`flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-semibold ${index === 0 ? "bg-[var(--rank-accent)]/15 text-[var(--rank-accent)]" : "bg-[var(--surface-raised)] text-[var(--secondary)]"}`}>{index + 1}</span><span className="flex-1 text-xs text-[#D4D9E8]">{item.state}</span><span className="tabular-nums text-xs font-medium text-[#E6EAF5]">{compactTransactions(item.transactions)}</span></div>)}
              </div>
            </div>
            <p className="mt-3 text-right text-[10px] text-[#8B94B3]">Map data © <a className="underline underline-offset-2 hover:text-[var(--accent)]" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></p>
          </section>
        </div>

        {/* Trends + Categories */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <section className="glass-card p-4 sm:p-6">
            <div className="mb-5 flex items-end justify-between">
              <div><p className="text-sm text-[#8B94B3]">Momentum</p><h2 className="mt-1 text-lg font-medium text-[#E6EAF5]">Quarterly transaction trend</h2></div>
              <span className="text-xs text-[#8B94B3]">{selectedYear ?? "All years"}</span>
            </div>
            <div className="h-64 sm:h-72">
              {loading ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trends} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--hairline)" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={(v) => { const [year, quarter] = String(v).split(" - "); return selectedYear ? quarter : quarter === "Q1" ? `’${year?.slice(-2)}` : ""; }} interval={0} tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} padding={{ left: 8, right: 20 }} />
                    <YAxis ticks={selectedYear ? undefined : trendTicks} tickFormatter={(v) => `${(v / 1e9).toFixed(0)}B`} tick={{ fontSize: 12, fill: "var(--muted)" }} axisLine={false} tickLine={false} domain={selectedYear && trends.length > 1 ? ["dataMin * 0.9", "dataMax * 1.05"] : [0, trendTicks[trendTicks.length - 1] || 10_000_000_000]} width={52} />
                    <Tooltip cursor={{ stroke: "var(--hairline)", strokeDasharray: "3 3" }} content={<DashboardDataTooltip />} />
                    <Area type="monotone" dataKey="transactions" stroke="var(--chart-accent)" strokeWidth={2.5} fill="var(--chart-accent)" fillOpacity={0.12} activeDot={{ r: 4, fill: "var(--chart-accent)", stroke: "var(--surface)", strokeWidth: 2 }} dot={({ cx, cy, index }: any) => index === trends.length - 1 ? <circle cx={cx} cy={cy} r={4} fill="var(--chart-accent)" stroke="var(--surface)" strokeWidth={2} /> : null} isAnimationActive />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          <section className="glass-card p-4 sm:p-6">
            <div className="mb-5"><p className="text-sm text-[#8B94B3]">Payment mix</p><h2 className="mt-1 text-lg font-medium text-[#E6EAF5]">Category share</h2></div>
            <div className="grid min-h-64 grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(190px,0.9fr)_minmax(170px,1.1fr)]">
              {loading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <div className="relative h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                    <Pie
                      data={categories}
                      dataKey="transactions"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      innerRadius={67}
                      outerRadius={94}
                      paddingAngle={4}
                      cornerRadius={5}
                    >
                      {categories.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                          stroke="transparent"
                        />
                      ))}
                    </Pie>
                    <Tooltip position={{ x: 0, y: 0 }} content={<DashboardDataTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="max-w-28 truncate text-xs text-[#8B94B3]">{categories[0]?.category ?? "No data"}</span>
                    <strong className="mono-numbers mt-0.5 text-2xl text-[#E6EAF5]">{categories.length ? `${((categories[0].transactions / categories.reduce((sum, item) => sum + item.transactions, 0)) * 100).toFixed(0)}%` : "—"}</strong>
                    <span className="text-xs text-[#8B94B3]">of transactions</span>
                  </div>
                </div>
              )}
              {!loading && <div className="space-y-3">
                {categories.map((category, index) => {
                  const total = categories.reduce((sum, item) => sum + item.transactions, 0) || 1;
                  const share = category.transactions / total * 100;
                  return <div key={category.category} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                      <span className="min-w-0 flex-1 truncate text-xs text-[#C7CDE0]">{category.category}</span>
                      <span className="text-xs font-semibold tabular-nums text-[#E6EAF5]">{share.toFixed(1)}%</span>
                    </div>
                    <div className="ml-[18px] flex items-center justify-between gap-2 text-[11px] text-[#8B94B3]">
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]"><span className="block h-full rounded-full" style={{ width: `${share}%`, backgroundColor: COLORS[index % COLORS.length] }} /></span>
                      <span>{category.amount > 0 ? compactRupees(category.amount) : ""}</span>
                    </div>
                  </div>;
                })}
              </div>}
            </div>
          </section>
        </div>

        {/* AI COPILOT */}
        <section className="copilot-frame overflow-hidden">
        <div className="glass-card overflow-hidden">
          <div className="border-b px-4 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-lg bg-black/[0.05] p-2 text-[#8B94B3] dark:bg-white/[0.06]">
                  <Bot size={18} aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-base font-medium text-[#E6EAF5] sm:text-lg">AI Copilot</h2>
                  <p className="text-sm text-[#8B94B3]">
                    {selectedYear ? `Viewing ${selectedYear}. Ask for “overall” or “all years” to include the full period.` : "Viewing all available years. Ask about a specific year to narrow the answer."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  setInput("");
                }}
                disabled={(messages.length === 0 && !input) || chatLoading}
                className="quiet-button inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Clear Copilot conversation"
              >
                <Trash2 size={13} aria-hidden="true" />
                Clear chat
              </button>
            </div>
          </div>

          <div className={`thin-scrollbar min-h-48 max-h-[65vh] space-y-5 overflow-y-auto bg-[var(--surface)] p-4 sm:p-6 ${messages.length === 0 ? "sm:min-h-52" : ""}`}>
            {messages.length === 0 && (
              <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center py-2">
                <p className="text-sm font-medium text-[#E6EAF5]">Explore the transaction data</p>
                <p className="mb-4 mt-1 text-center text-sm text-[#8B94B3]">Choose a question or write your own</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {COPILOT_SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => handleSend(suggestion)}
                      disabled={chatLoading}
                      className="suggestion-chip rounded-md border px-3 py-2 text-left text-sm text-[#C7CDE0] transition-colors disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, index) => (
              <div key={index} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="mt-5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black/[0.05] text-[#8B94B3] dark:bg-white/[0.06]">
                    <Bot size={16} aria-hidden="true" />
                  </div>
                )}
                <div className={`flex max-w-[88%] flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  <span className="px-1 text-xs text-[#8B94B3]">
                    {msg.role === "user" ? "You" : "AI Copilot"}
                  </span>
                  <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "copilot-user-bubble rounded-br-md"
                      : "copilot-assistant-bubble rounded-tl-md border"
                  }`}>
                    {msg.role === "assistant" ? (
                      <>
                        {index > 0 && /\b(overall|all years|combined|entire period)\b/i.test(messages[index - 1]?.content ?? "") && <p className="mb-2 text-xs text-[#8B94B3]">Scope: all years</p>}
                        <FormattedAnswer text={msg.content} />
                        {msg.chart && (
                          <section className="mt-4 w-full min-w-0 rounded-lg border bg-[var(--surface)] p-3" aria-label={msg.chart.title}>
                            <h4 className={`mb-2 text-xs font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{msg.chart.title}</h4>
                            <div className="h-52 w-full">
                              <ResponsiveContainer width="100%" height="100%">
                                {msg.chart.type === "pie" ? (
                                  <PieChart>
                                  <Tooltip formatter={(value: any, name: any) => [formatCopilotChartValue(msg.chart!, Number(value)), String(name)]} contentStyle={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 8, color: "var(--foreground)", fontSize: 12 }} />
                                    <Pie data={msg.chart.data} dataKey={msg.chart.valueKey ?? "transactions"} nameKey={msg.chart.labelKey ?? "year"} cx="50%" cy="50%" outerRadius="76%" innerRadius="30%" paddingAngle={3} label={({ name, percent }: any) => `${name}: ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                                      {msg.chart.data.map((_, pointIndex) => <Cell key={pointIndex} fill={COLORS[pointIndex % COLORS.length]} />)}
                                    </Pie>
                                  </PieChart>
                                ) : msg.chart.type === "line" ? (
                                  <LineChart data={msg.chart.data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                                    <CartesianGrid vertical={false} stroke="var(--hairline)" />
                                    <XAxis dataKey={msg.chart.labelKey ?? "year"} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                                    <YAxis width={64} tickLine={false} axisLine={false} tickFormatter={(value: number) => formatCopilotChartValue(msg.chart!, value)} tick={{ fill: "var(--muted)", fontSize: 10 }} />
                                    <Tooltip formatter={(value: any, name: any) => [formatCopilotChartValue(msg.chart!, Number(value)), msg.chart?.series?.find((item) => item.key === name)?.label ?? msg.chart?.valueLabel ?? String(name)]} contentStyle={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 8, color: "var(--foreground)", fontSize: 12 }} />
                                    {(msg.chart.series?.length ? msg.chart.series : [{ key: msg.chart.valueKey ?? "transactions", label: msg.chart.valueLabel ?? "Transactions", color: "var(--chart-accent)" }]).map((series, seriesIndex) => <Line key={series.key} type="monotone" dataKey={series.key} name={series.label} stroke={COLORS[seriesIndex % COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />)}
                                  </LineChart>
                                ) : msg.chart.type === "area" ? (
                                  <AreaChart data={msg.chart.data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                                    <CartesianGrid vertical={false} stroke="var(--hairline)" />
                                    <XAxis dataKey={msg.chart.labelKey ?? "year"} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                                    <YAxis width={64} tickLine={false} axisLine={false} tickFormatter={(value: number) => formatCopilotChartValue(msg.chart!, value)} tick={{ fill: "var(--muted)", fontSize: 10 }} />
                                    <Tooltip formatter={(value: any, name: any) => [formatCopilotChartValue(msg.chart!, Number(value)), msg.chart?.series?.find((item) => item.key === name)?.label ?? msg.chart?.valueLabel ?? String(name)]} contentStyle={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 8, color: "var(--foreground)", fontSize: 12 }} />
                                    {(msg.chart.series?.length ? msg.chart.series : [{ key: msg.chart.valueKey ?? "transactions", label: msg.chart.valueLabel ?? "Transactions", color: "var(--chart-accent)" }]).map((series, seriesIndex) => <Area key={series.key} type="monotone" dataKey={series.key} name={series.label} stroke={COLORS[seriesIndex % COLORS.length]} strokeWidth={2} fill={COLORS[seriesIndex % COLORS.length]} fillOpacity={0.12} connectNulls />)}
                                  </AreaChart>
                                ) : (
                                <BarChart data={msg.chart.data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                                  <CartesianGrid vertical={false} stroke="var(--hairline)" />
                                  <XAxis dataKey={msg.chart.labelKey ?? "year"} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                                  <YAxis width={64} tickLine={false} axisLine={false} tickFormatter={(value: number) => formatCopilotChartValue(msg.chart!, value)} tick={{ fill: "var(--muted)", fontSize: 10 }} />
                                  <Tooltip
                                    formatter={(value: any, name: any) => [formatCopilotChartValue(msg.chart!, Number(value)), msg.chart?.series?.find((item) => item.key === name)?.label ?? msg.chart?.valueLabel ?? String(name)]}
                                    labelFormatter={(label: any) => String(label)}
                                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 8, color: "var(--foreground)", fontSize: 12 }}
                                  />
                                  {(msg.chart.series?.length ? msg.chart.series : [{ key: msg.chart.valueKey ?? "transactions", label: msg.chart.valueLabel ?? "Transactions", color: "var(--chart-accent)" }]).map((series, seriesIndex) => <Bar key={series.key} dataKey={series.key} name={series.label} fill={COLORS[seriesIndex % COLORS.length]} radius={[3, 3, 0, 0]} maxBarSize={44}>{msg.chart?.series?.length === 1 && <LabelList dataKey={series.key} position="top" formatter={(value: any) => formatCopilotChartValue(msg.chart!, Number(value))} fill="var(--secondary)" fontSize={11} />}</Bar>)}
                                </BarChart>
                                )}
                              </ResponsiveContainer>
                            </div>
                            {msg.chart.note && <p className={`mt-2 text-[11px] leading-relaxed ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{msg.chart.note}</p>}
                          </section>
                        )}
                      </>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {chatLoading && !responseStarted && (
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-black/[0.05] text-[#8B94B3] dark:bg-white/[0.06]">
                  <Bot size={16} aria-hidden="true" />
                </div>
                <div className="copilot-assistant-bubble flex items-center gap-2 rounded-xl rounded-tl-md border px-4 py-3 text-sm">
                  <span>Working through the selected data</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="border-t bg-[var(--surface)] p-3 sm:p-4">
            <div className="flex gap-2 sm:gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Ask about any year, states, trends, or categories..."
                className="copilot-input flex-1 rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors sm:px-4 sm:py-3"
              />
              <button
                onClick={() => handleSend()}
                disabled={chatLoading || !input.trim()}
                className="copilot-send inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed sm:px-5 sm:py-3"
              >
                <span className="hidden sm:inline">Send</span>
                <Send size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        </section>
        <footer className="flex flex-col gap-2 border-t py-5 text-sm text-[#8B94B3] sm:flex-row sm:items-center sm:justify-between">
          <span>Data: PhonePe Pulse <span className="mx-1">·</span> Gemini API</span>
          <span>Data through {trends.length ? trends[trends.length - 1].period.replace(" - ", " ") : "—"}</span>
        </footer>
      </main>
    </div>
  );
}
