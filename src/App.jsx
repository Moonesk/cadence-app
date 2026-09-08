import { useState, useMemo, useEffect } from "react";
import {
  MapPin,
  CalendarDays,
  Bell,
  Plane,
  TrainFront,
  Building2,
  PartyPopper,
  Sparkles,
  Info,
  Search,
} from "lucide-react";

function normalize(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/* ---------------------------------------------------------
   Génération des courbes de demande (0-100) sur 24h
   à partir de "pics" gaussiens (heure, largeur, hauteur).
--------------------------------------------------------- */
function gaussAt(hour, center, width, height) {
  let d = Math.abs(hour - center);
  d = Math.min(d, 24 - d); // boucle sur 24h
  return height * Math.exp(-(d * d) / (2 * width * width));
}
function buildCurve(peaks, baseline) {
  return Array.from({ length: 24 }, (_, h) => {
    const v = peaks.reduce((s, p) => s + gaussAt(h, p.c, p.w, p.h), baseline);
    return Math.round(Math.min(100, Math.max(0, v)));
  });
}

const ICONS = {
  airport: Plane,
  station: TrainFront,
  business: Building2,
  nightlife: PartyPopper,
  leisure: Sparkles,
};

/* ---------------------------------------------------------
   Données des villes (démo — logique horaire, pas de flux
   temps réel de courses).
--------------------------------------------------------- */
const RAW_CITIES = {
  paris: {
    label: "Paris",
    lat: 48.8566,
    lon: 2.3522,
    zones: [
      { id: "cdg", name: "Roissy CDG", type: "airport", baseline: 10,
        weekday: [{ c: 6, w: 1.4, h: 55 }, { c: 22, w: 1.4, h: 58 }],
        weekend: [{ c: 7, w: 1.6, h: 48 }, { c: 22, w: 1.6, h: 52 }] },
      { id: "gares", name: "Gare du Nord / Gare de Lyon", type: "station", baseline: 14,
        weekday: [{ c: 8, w: 1.1, h: 68 }, { c: 18, w: 1.1, h: 62 }],
        weekend: [{ c: 11, w: 2, h: 38 }, { c: 19, w: 2, h: 42 }] },
      { id: "defense", name: "La Défense", type: "business", baseline: 6,
        weekday: [{ c: 8, w: 1, h: 75 }, { c: 18, w: 1, h: 80 }],
        weekend: [{ c: 14, w: 3, h: 12 }] },
      { id: "bastille", name: "Bastille / Oberkampf", type: "nightlife", baseline: 8,
        weekday: [{ c: 23, w: 1.4, h: 32 }],
        weekend: [{ c: 23, w: 1.8, h: 82 }, { c: 1, w: 1.4, h: 58 }] },
      { id: "champs", name: "Champs-Élysées / Opéra", type: "leisure", baseline: 12,
        weekday: [{ c: 13, w: 3, h: 36 }, { c: 19, w: 2, h: 28 }],
        weekend: [{ c: 15, w: 3, h: 52 }, { c: 21, w: 2, h: 48 }] },
    ],
    events: [
      { name: "Match au Parc des Princes", date: "sam. 19 sept. 2026", time: "21h00", zone: "Boulogne-Billancourt", impact: "Fort" },
      { name: "Salon professionnel — Porte de Versailles", date: "mar. 6 oct. 2026", time: "9h00 – 18h00", zone: "Porte de Versailles", impact: "Moyen" },
      { name: "Concert à l'AccorHotels Arena", date: "ven. 16 oct. 2026", time: "20h30", zone: "Bercy", impact: "Fort" },
    ],
  },
  lyon: {
    label: "Lyon",
    lat: 45.764,
    lon: 4.8357,
    zones: [
      { id: "sxb", name: "Aéroport Saint-Exupéry", type: "airport", baseline: 9,
        weekday: [{ c: 6, w: 1.4, h: 48 }, { c: 21, w: 1.4, h: 52 }],
        weekend: [{ c: 7, w: 1.6, h: 40 }, { c: 21, w: 1.6, h: 44 }] },
      { id: "partdieu", name: "Part-Dieu", type: "station", baseline: 12,
        weekday: [{ c: 8, w: 1, h: 66 }, { c: 18, w: 1, h: 66 }],
        weekend: [{ c: 11, w: 2, h: 34 }] },
      { id: "confluence", name: "Confluence", type: "leisure", baseline: 10,
        weekday: [{ c: 13, w: 2, h: 28 }, { c: 19, w: 2, h: 32 }],
        weekend: [{ c: 15, w: 3, h: 48 }] },
      { id: "vieuxlyon", name: "Vieux Lyon / Presqu'île", type: "nightlife", baseline: 7,
        weekday: [{ c: 23, w: 1.4, h: 28 }],
        weekend: [{ c: 23, w: 1.8, h: 78 }, { c: 1, w: 1.4, h: 52 }] },
      { id: "gerland", name: "Gerland", type: "business", baseline: 8,
        weekday: [{ c: 8, w: 1, h: 40 }, { c: 18, w: 1.5, h: 30 }],
        weekend: [{ c: 20, w: 2, h: 20 }] },
    ],
    events: [
      { name: "Match à l'Groupama Stadium", date: "dim. 20 sept. 2026", time: "17h00", zone: "Décines-Charpieu", impact: "Fort" },
      { name: "Concert à la Halle Tony Garnier", date: "jeu. 8 oct. 2026", time: "20h00", zone: "Gerland", impact: "Moyen" },
    ],
  },
  marseille: {
    label: "Marseille",
    lat: 43.2965,
    lon: 5.3698,
    zones: [
      { id: "mrs", name: "Aéroport Marseille Provence", type: "airport", baseline: 9,
        weekday: [{ c: 6, w: 1.4, h: 44 }, { c: 21, w: 1.4, h: 48 }],
        weekend: [{ c: 7, w: 1.6, h: 38 }, { c: 21, w: 1.6, h: 40 }] },
      { id: "stcharles", name: "Saint-Charles", type: "station", baseline: 12,
        weekday: [{ c: 8, w: 1, h: 62 }, { c: 18, w: 1, h: 58 }],
        weekend: [{ c: 12, w: 2, h: 34 }] },
      { id: "vieuxport", name: "Vieux-Port", type: "nightlife", baseline: 10,
        weekday: [{ c: 20, w: 2, h: 32 }],
        weekend: [{ c: 22, w: 2, h: 74 }, { c: 0, w: 1.4, h: 54 }] },
      { id: "prado", name: "Prado / 8e", type: "business", baseline: 8,
        weekday: [{ c: 8, w: 1, h: 52 }, { c: 18, w: 1, h: 52 }],
        weekend: [{ c: 14, w: 3, h: 14 }] },
      { id: "castellane", name: "Castellane", type: "leisure", baseline: 10,
        weekday: [{ c: 13, w: 2, h: 26 }],
        weekend: [{ c: 22, w: 2, h: 46 }] },
    ],
    events: [
      { name: "Match au Vélodrome", date: "sam. 26 sept. 2026", time: "20h00", zone: "Vélodrome", impact: "Fort" },
      { name: "Festival au Vieux-Port", date: "ven. 2 oct. 2026", time: "18h00 – minuit", zone: "Vieux-Port", impact: "Moyen" },
    ],
  },
  toulouse: {
    label: "Toulouse",
    lat: 43.6047,
    lon: 1.4442,
    zones: [
      { id: "blagnac", name: "Aéroport Blagnac", type: "airport", baseline: 9,
        weekday: [{ c: 6, w: 1.4, h: 44 }, { c: 21, w: 1.4, h: 46 }],
        weekend: [{ c: 7, w: 1.6, h: 36 }, { c: 21, w: 1.6, h: 38 }] },
      { id: "matabiau", name: "Matabiau", type: "station", baseline: 11,
        weekday: [{ c: 8, w: 1, h: 58 }, { c: 18, w: 1, h: 56 }],
        weekend: [{ c: 12, w: 2, h: 30 }] },
      { id: "capitole", name: "Capitole / centre-ville", type: "nightlife", baseline: 10,
        weekday: [{ c: 20, w: 2, h: 32 }],
        weekend: [{ c: 22, w: 2, h: 68 }, { c: 0, w: 1.4, h: 48 }] },
      { id: "compans", name: "Compans-Caffarelli", type: "business", baseline: 7,
        weekday: [{ c: 8, w: 1, h: 48 }, { c: 18, w: 1, h: 48 }],
        weekend: [{ c: 14, w: 3, h: 10 }] },
      { id: "stcyprien", name: "Saint-Cyprien", type: "leisure", baseline: 9,
        weekday: [{ c: 13, w: 2, h: 22 }],
        weekend: [{ c: 16, w: 3, h: 32 }] },
    ],
    events: [
      { name: "Match au Stadium de Toulouse", date: "dim. 27 sept. 2026", time: "15h00", zone: "Stadium", impact: "Fort" },
      { name: "Salon au Parc des Expositions", date: "mer. 14 oct. 2026", time: "9h00 – 19h00", zone: "Parc des Expos", impact: "Moyen" },
    ],
  },
  rennes: {
    label: "Rennes",
    lat: 48.1173,
    lon: -1.6778,
    zones: [
      { id: "gare-rennes", name: "Gare de Rennes", type: "station", baseline: 12,
        weekday: [{ c: 8, w: 1, h: 62 }, { c: 18, w: 1, h: 60 }],
        weekend: [{ c: 12, w: 2, h: 34 }, { c: 19, w: 2, h: 32 }] },
      { id: "aeroport-rennes", name: "Aéroport Rennes - Saint-Jacques", type: "airport", baseline: 6,
        weekday: [{ c: 7, w: 1.4, h: 26 }, { c: 20, w: 1.4, h: 28 }],
        weekend: [{ c: 8, w: 1.6, h: 22 }, { c: 20, w: 1.6, h: 22 }] },
      { id: "sainte-anne", name: "Sainte-Anne / rue de la Soif", type: "nightlife", baseline: 8,
        weekday: [{ c: 23, w: 1.4, h: 34 }],
        weekend: [{ c: 23, w: 1.8, h: 80 }, { c: 1, w: 1.4, h: 56 }] },
      { id: "beaulieu", name: "Beaulieu (campus)", type: "business", baseline: 7,
        weekday: [{ c: 8, w: 1, h: 48 }, { c: 17, w: 1.2, h: 44 }],
        weekend: [{ c: 14, w: 3, h: 10 }] },
      { id: "colombier", name: "Colombier / centre commercial", type: "leisure", baseline: 9,
        weekday: [{ c: 13, w: 2, h: 26 }, { c: 18, w: 2, h: 24 }],
        weekend: [{ c: 15, w: 3, h: 42 }] },
    ],
    events: [
      { name: "Match au Roazhon Park", date: "sam. 19 sept. 2026", time: "17h00", zone: "Roazhon Park", impact: "Fort" },
      { name: "Concert au Liberté", date: "ven. 25 sept. 2026", time: "20h00", zone: "Centre-ville", impact: "Moyen" },
    ],
  },
};

// URL de votre serveur relais déployé sur Render
const SERVER_BASE_URL = "https://cadence-server-w1do.onrender.com";

// Nom de la gare principale à interroger pour chaque ville
const STATION_NAMES = {
  paris: "Paris Gare de Lyon",
  lyon: "Lyon Part-Dieu",
  marseille: "Marseille Saint-Charles",
  toulouse: "Toulouse Matabiau",
  rennes: "Rennes",
};

// Précalcul des courbes (semaine / week-end) une seule fois
const ARRIVALS = {
  paris: {
    trainsArr: [
      { time: "06:52", label: "TGV en provenance de Marseille" },
      { time: "08:15", label: "TGV en provenance de Lyon" },
      { time: "09:40", label: "Eurostar en provenance de Londres" },
      { time: "12:05", label: "TGV en provenance de Bordeaux" },
      { time: "17:30", label: "TGV en provenance de Lille" },
      { time: "20:10", label: "TGV en provenance de Strasbourg" },
    ],
    trainsDep: [
      { time: "07:05", label: "TGV à destination de Lyon" },
      { time: "09:35", label: "Eurostar à destination de Londres" },
      { time: "11:20", label: "TGV à destination de Marseille" },
      { time: "16:05", label: "TGV à destination de Rennes" },
      { time: "18:45", label: "TGV à destination de Bordeaux" },
      { time: "21:15", label: "TGV à destination de Strasbourg" },
    ],
    flightsArr: [
      { time: "07:20", label: "Vol en provenance de New York JFK" },
      { time: "10:45", label: "Vol en provenance de Casablanca" },
      { time: "14:30", label: "Vol en provenance de Tokyo Haneda" },
      { time: "19:05", label: "Vol en provenance de Rome Fiumicino" },
      { time: "22:40", label: "Vol en provenance de Dubaï" },
    ],
    flightsDep: [
      { time: "08:10", label: "Vol à destination de Casablanca" },
      { time: "12:00", label: "Vol à destination de Rome Fiumicino" },
      { time: "16:25", label: "Vol à destination de Dubaï" },
      { time: "21:15", label: "Vol à destination de New York JFK" },
    ],
  },
  lyon: {
    trainsArr: [
      { time: "07:10", label: "TGV en provenance de Paris" },
      { time: "09:35", label: "TGV en provenance de Marseille" },
      { time: "13:00", label: "TGV en provenance de Genève" },
      { time: "16:45", label: "TGV en provenance de Bordeaux" },
      { time: "19:20", label: "TGV en provenance de Paris" },
    ],
    trainsDep: [
      { time: "07:45", label: "TGV à destination de Marseille" },
      { time: "10:20", label: "TGV à destination de Paris" },
      { time: "14:05", label: "TGV à destination de Genève" },
      { time: "18:00", label: "TGV à destination de Paris" },
      { time: "20:30", label: "TGV à destination de Bordeaux" },
    ],
    flightsArr: [
      { time: "08:05", label: "Vol en provenance d'Alger" },
      { time: "11:30", label: "Vol en provenance de Londres" },
      { time: "15:50", label: "Vol en provenance de Porto" },
      { time: "20:15", label: "Vol en provenance de Tunis" },
    ],
    flightsDep: [
      { time: "09:00", label: "Vol à destination de Londres" },
      { time: "13:15", label: "Vol à destination d'Alger" },
      { time: "17:40", label: "Vol à destination de Tunis" },
      { time: "21:20", label: "Vol à destination de Porto" },
    ],
  },
  marseille: {
    trainsArr: [
      { time: "06:58", label: "TGV en provenance de Paris" },
      { time: "10:20", label: "TGV en provenance de Lyon" },
      { time: "13:45", label: "TGV en provenance de Nice" },
      { time: "17:10", label: "TGV en provenance de Paris" },
      { time: "21:00", label: "TER en provenance d'Avignon" },
    ],
    trainsDep: [
      { time: "07:30", label: "TGV à destination de Nice" },
      { time: "10:50", label: "TGV à destination de Paris" },
      { time: "14:20", label: "TGV à destination de Lyon" },
      { time: "18:00", label: "TGV à destination de Paris" },
      { time: "21:30", label: "TER à destination d'Avignon" },
    ],
    flightsArr: [
      { time: "07:40", label: "Vol en provenance d'Alger" },
      { time: "12:10", label: "Vol en provenance d'Ajaccio" },
      { time: "16:35", label: "Vol en provenance de Paris Orly" },
      { time: "20:50", label: "Vol en provenance de Tunis" },
    ],
    flightsDep: [
      { time: "08:20", label: "Vol à destination d'Ajaccio" },
      { time: "13:00", label: "Vol à destination de Paris Orly" },
      { time: "17:25", label: "Vol à destination de Tunis" },
      { time: "21:40", label: "Vol à destination d'Alger" },
    ],
  },
  toulouse: {
    trainsArr: [
      { time: "07:05", label: "TGV en provenance de Paris" },
      { time: "10:50", label: "TGV en provenance de Bordeaux" },
      { time: "14:15", label: "TGV en provenance de Paris" },
      { time: "18:40", label: "Intercités en provenance de Bayonne" },
    ],
    trainsDep: [
      { time: "07:40", label: "TGV à destination de Bordeaux" },
      { time: "11:25", label: "TGV à destination de Paris" },
      { time: "15:00", label: "Intercités à destination de Bayonne" },
      { time: "19:15", label: "TGV à destination de Paris" },
    ],
    flightsArr: [
      { time: "08:20", label: "Vol en provenance de Paris Orly" },
      { time: "12:45", label: "Vol en provenance de Londres" },
      { time: "16:10", label: "Vol en provenance de Casablanca" },
      { time: "21:05", label: "Vol en provenance de Lisbonne" },
    ],
    flightsDep: [
      { time: "09:10", label: "Vol à destination de Londres" },
      { time: "13:35", label: "Vol à destination de Paris Orly" },
      { time: "17:00", label: "Vol à destination de Lisbonne" },
      { time: "21:50", label: "Vol à destination de Casablanca" },
    ],
  },
  rennes: {
    trainsArr: [
      { time: "07:12", label: "TGV en provenance de Paris Montparnasse" },
      { time: "09:45", label: "TER en provenance de Brest" },
      { time: "12:30", label: "TGV en provenance de Paris Montparnasse" },
      { time: "16:05", label: "TER en provenance de Saint-Malo" },
      { time: "19:50", label: "TGV en provenance de Paris Montparnasse" },
      { time: "22:15", label: "TER en provenance de Nantes" },
    ],
    trainsDep: [
      { time: "07:35", label: "TGV à destination de Paris Montparnasse" },
      { time: "10:15", label: "TER à destination de Saint-Malo" },
      { time: "13:05", label: "TER à destination de Brest" },
      { time: "17:20", label: "TGV à destination de Paris Montparnasse" },
      { time: "20:30", label: "TER à destination de Nantes" },
    ],
    flightsArr: [
      { time: "07:50", label: "Vol en provenance de Lyon" },
      { time: "13:20", label: "Vol en provenance de Londres" },
      { time: "18:40", label: "Vol en provenance de Marseille" },
    ],
    flightsDep: [
      { time: "08:30", label: "Vol à destination de Londres" },
      { time: "14:10", label: "Vol à destination de Lyon" },
      { time: "19:25", label: "Vol à destination de Marseille" },
    ],
  },
};
const CITIES = Object.fromEntries(
  Object.entries(RAW_CITIES).map(([key, city]) => [
    key,
    {
      ...city,
      zones: city.zones.map((z) => ({
        ...z,
        curveWeekday: buildCurve(z.weekday, z.baseline),
        curveWeekend: buildCurve(z.weekend, z.baseline),
      })),
    },
  ])
);

/* ---------------------------------------------------------
   Couleurs — interpolation entre un ton froid (faible
   demande) et un ton chaud (forte demande). La couleur
   porte l'information, ce n'est pas une décoration.
--------------------------------------------------------- */
const COOL = [62, 142, 138]; // #3E8E8A
const WARM = [232, 147, 74]; // #E8934A
function demandColor(score) {
  const t = Math.min(1, Math.max(0, score / 100));
  const rgb = COOL.map((c, i) => Math.round(c + (WARM[i] - c) * t));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function Sparkline({ values, hour }) {
  const w = 100;
  const h = 28;
  const pts = values
    .map((v, i) => `${(i / 23) * w},${h - (v / 100) * h}`)
    .join(" ");
  const cx = (hour / 23) * w;
  const cy = h - (values[hour] / 100) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke="#4B5359"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={cx} cy={cy} r="2.6" fill={demandColor(values[hour])} />
    </svg>
  );
}

export default function App() {
  const now = useMemo(() => new Date(), []);
  const [cityKey, setCityKey] = useState("paris");
  const [cityQuery, setCityQuery] = useState("");
  const [showCityList, setShowCityList] = useState(false);
  const [dayOffset, setDayOffset] = useState(0); // 0 = aujourd'hui, 1 = demain
  const [hour, setHour] = useState(now.getHours());
  const [tab, setTab] = useState("demande");
  const [trafficMode, setTrafficMode] = useState("arrivals"); // "arrivals" | "departures"
  const [liveTraffic, setLiveTraffic] = useState({ status: "idle", trains: [], flights: [] });

  useEffect(() => {
    if (tab !== "arrivees") return;
    let cancelled = false;
    setLiveTraffic({ status: "loading", trains: [], flights: [] });
    const station = STATION_NAMES[cityKey];
    Promise.all([
      fetch(
        `${SERVER_BASE_URL}/api/trains?station=${encodeURIComponent(station)}&kind=${trafficMode}`
      ).then((r) => r.json()),
      fetch(`${SERVER_BASE_URL}/api/flights?city=${cityKey}&kind=${trafficMode}`).then((r) => r.json()),
    ])
      .then(([trainsRes, flightsRes]) => {
        if (cancelled) return;
        if (trainsRes.error || flightsRes.error) {
          setLiveTraffic({ status: "error", trains: [], flights: [] });
        } else {
          setLiveTraffic({ status: "ready", trains: trainsRes.result || [], flights: flightsRes.result || [] });
        }
      })
      .catch(() => {
        if (!cancelled) setLiveTraffic({ status: "error", trains: [], flights: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [tab, cityKey, trafficMode]);

  const [liveEvents, setLiveEvents] = useState({ status: "idle", events: [] });

  useEffect(() => {
    if (tab !== "evenements" && tab !== "alertes") return;
    let cancelled = false;
    setLiveEvents({ status: "loading", events: [] });
    fetch(`${SERVER_BASE_URL}/api/events?city=${cityKey}`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setLiveEvents({ status: "error", events: [] });
        } else {
          setLiveEvents({ status: "ready", events: res.result || [] });
        }
      })
      .catch(() => {
        if (!cancelled) setLiveEvents({ status: "error", events: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [tab, cityKey]);

  const city = CITIES[cityKey];

  const targetDate = useMemo(() => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    return d;
  }, [now, dayOffset]);
  const dayType = [0, 6].includes(targetDate.getDay()) ? "weekend" : "weekday";

  const cityMatches = useMemo(() => {
    if (!cityQuery.trim()) return [];
    const q = normalize(cityQuery);
    return Object.entries(CITIES).filter(([, c]) => normalize(c.label).includes(q));
  }, [cityQuery]);

  const zonesScored = useMemo(() => {
    return city.zones
      .map((z) => {
        const curve = dayType === "weekday" ? z.curveWeekday : z.curveWeekend;
        return { ...z, curve, score: curve[hour] };
      })
      .sort((a, b) => b.score - a.score);
  }, [city, dayType, hour]);

  const hotZones = zonesScored.filter((z) => z.score >= 70);
  const hourLabel = `${String(hour).padStart(2, "0")}:00`;
  const dayLabel = dayOffset === 0 ? "aujourd'hui" : "demain";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0B0C0D",
        display: "flex",
        justifyContent: "center",
        padding: "24px 12px",
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .chip { transition: background .15s ease, color .15s ease, border-color .15s ease; }
        .navbtn { transition: color .15s ease; }
        input[type="range"] {
          -webkit-appearance: none;
          height: 3px;
          background: #33393E;
          border-radius: 2px;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px; height: 16px; border-radius: 50%;
          background: #E8934A;
          border: 2px solid #14171A;
          cursor: pointer;
          margin-top: -6.5px;
        }
      `}</style>

      {/* Cadre "téléphone" */}
      <div
        style={{
          width: 390,
          maxWidth: "100%",
          background: "#14171A",
          borderRadius: 28,
          border: "1px solid #262B2F",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minHeight: 720,
          color: "#EDEFEF",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 18px 12px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <h1
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700,
                fontSize: 22,
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              Cadence
            </h1>
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, color: "#9BA3A8" }}>
              {hourLabel}
            </span>
          </div>
          <p style={{ margin: "2px 0 14px", fontSize: 13, color: "#9BA3A8" }}>
            Où et quand la demande est forte
          </p>

          {/* Recherche de ville */}
          <div style={{ position: "relative" }}>
            <div style={{ position: "relative" }}>
              <Search
                size={15}
                color="#6D757B"
                style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}
              />
              <input
                value={cityQuery}
                onChange={(e) => {
                  setCityQuery(e.target.value);
                  setShowCityList(true);
                }}
                onFocus={() => setShowCityList(true)}
                onBlur={() => setTimeout(() => setShowCityList(false), 120)}
                placeholder={`Votre ville (ex. ${city.label})`}
                style={{
                  width: "100%",
                  padding: "9px 12px 9px 32px",
                  borderRadius: 10,
                  border: "1px solid #33393E",
                  background: "#1D2124",
                  color: "#EDEFEF",
                  fontSize: 13.5,
                  outline: "none",
                }}
              />
            </div>

            {showCityList && cityQuery.trim() && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  left: 0,
                  right: 0,
                  background: "#1D2124",
                  border: "1px solid #33393E",
                  borderRadius: 10,
                  overflow: "hidden",
                  zIndex: 5,
                }}
              >
                {cityMatches.length > 0 ? (
                  cityMatches.map(([key, c]) => (
                    <button
                      key={key}
                      onMouseDown={() => {
                        setCityKey(key);
                        setCityQuery(c.label);
                        setShowCityList(false);
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "9px 12px",
                        background: "none",
                        border: "none",
                        color: "#EDEFEF",
                        fontSize: 13.5,
                        cursor: "pointer",
                      }}
                    >
                      {c.label}
                    </button>
                  ))
                ) : (
                  <div style={{ padding: "10px 12px", fontSize: 12.5, color: "#9BA3A8" }}>
                    Cadence n'est pas encore disponible pour « {cityQuery} ». Villes couvertes pour l'instant :{" "}
                    {Object.values(CITIES).map((c) => c.label).join(", ")}.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Corps scrollable */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 18px 18px" }}>
          {tab === "demande" && (
            <>
              {/* Jour + heure */}
              <div
                style={{
                  background: "#1D2124",
                  border: "1px solid #262B2F",
                  borderRadius: 14,
                  padding: "14px 16px",
                  marginBottom: 16,
                }}
              >
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {[
                    [0, "Aujourd'hui"],
                    [1, "Demain"],
                  ].map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setDayOffset(val)}
                      style={{
                        flex: 1,
                        padding: "7px 0",
                        borderRadius: 8,
                        border: "1px solid " + (dayOffset === val ? "#E8934A" : "#33393E"),
                        background: dayOffset === val ? "rgba(232,147,74,0.12)" : "transparent",
                        color: dayOffset === val ? "#E8934A" : "#9BA3A8",
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={23}
                  value={hour}
                  onChange={(e) => setHour(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6D757B", marginTop: 4 }}>
                  <span>00:00</span>
                  <span>12:00</span>
                  <span>23:00</span>
                </div>
              </div>

              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: "0 0 10px" }}>
                Demande par zone — {city.label}, {dayLabel}
              </h2>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {zonesScored.map((z) => {
                  const Icon = ICONS[z.type];
                  return (
                    <div
                      key={z.id}
                      style={{
                        background: "#1D2124",
                        border: "1px solid #262B2F",
                        borderRadius: 14,
                        padding: "12px 14px",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: "#262B2F",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Icon size={17} color={demandColor(z.score)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {z.name}
                        </div>
                        <Sparkline values={z.curve} hour={hour} />
                      </div>
                      <div
                        style={{
                          fontFamily: "'Space Grotesk', sans-serif",
                          fontWeight: 600,
                          fontSize: 17,
                          color: demandColor(z.score),
                          width: 34,
                          textAlign: "right",
                          flexShrink: 0,
                        }}
                      >
                        {z.score}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16, padding: "10px 12px", background: "#1D2124", borderRadius: 10, border: "1px solid #262B2F" }}>
                <Info size={15} color="#6D757B" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: 11.5, color: "#6D757B", lineHeight: 1.5 }}>
                  Estimations basées sur des tendances horaires typiques (données de démonstration), pas sur un flux de courses en temps réel.
                </p>
              </div>
            </>
          )}

          {tab === "arrivees" && (
            <>
              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: "8px 0 4px" }}>
                Trafic gare / aéroport — {city.label}, {dayLabel}
              </h2>
              <p style={{ fontSize: 12, color: "#9BA3A8", margin: "0 0 12px" }}>
                Arrivées et départs créent de la demande ponctuelle à la gare et à l'aéroport.
              </p>

              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {[
                  ["arrivals", "Arrivées"],
                  ["departures", "Départs"],
                ].map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setTrafficMode(val)}
                    style={{
                      flex: 1,
                      padding: "7px 0",
                      borderRadius: 8,
                      border: "1px solid " + (trafficMode === val ? "#E8934A" : "#33393E"),
                      background: trafficMode === val ? "rgba(232,147,74,0.12)" : "transparent",
                      color: trafficMode === val ? "#E8934A" : "#9BA3A8",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background:
                      liveTraffic.status === "ready" ? "#3E8E8A" : liveTraffic.status === "error" ? "#D9635A" : "#6D757B",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 11.5, color: "#9BA3A8" }}>
                  {liveTraffic.status === "loading" && "Récupération des vraies données…"}
                  {liveTraffic.status === "ready" && "Données en direct (serveur Cadence)"}
                  {liveTraffic.status === "error" && "Serveur injoignable — horaires indicatifs affichés"}
                </span>
              </div>

              <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: "#9BA3A8", margin: "0 0 8px" }}>
                Trains
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
                {(liveTraffic.status === "ready"
                  ? liveTraffic.trains
                  : trafficMode === "arrivals"
                  ? ARRIVALS[cityKey].trainsArr
                  : ARRIVALS[cityKey].trainsDep
                ).map((t, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      background: "#1D2124",
                      border: "1px solid #262B2F",
                      borderRadius: 10,
                      padding: "9px 12px",
                    }}
                  >
                    <TrainFront size={15} color="#3E8E8A" style={{ flexShrink: 0 }} />
                    <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, width: 44, flexShrink: 0 }}>
                      {t.time}
                    </span>
                    <span style={{ fontSize: 13, color: "#C7CCCF" }}>{t.label}</span>
                  </div>
                ))}
              </div>

              <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: "#9BA3A8", margin: "0 0 8px" }}>
                Vols
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(liveTraffic.status === "ready"
                  ? liveTraffic.flights
                  : trafficMode === "arrivals"
                  ? ARRIVALS[cityKey].flightsArr
                  : ARRIVALS[cityKey].flightsDep
                ).map((f, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      background: "#1D2124",
                      border: "1px solid #262B2F",
                      borderRadius: 10,
                      padding: "9px 12px",
                    }}
                  >
                    <Plane size={15} color="#E8934A" style={{ flexShrink: 0 }} />
                    <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, width: 44, flexShrink: 0 }}>
                      {f.time}
                    </span>
                    <span style={{ fontSize: 13, color: "#C7CCCF" }}>{f.label}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16, padding: "10px 12px", background: "#1D2124", borderRadius: 10, border: "1px solid #262B2F" }}>
                <Info size={15} color="#6D757B" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: 11.5, color: "#6D757B", lineHeight: 1.5 }}>
                  {liveTraffic.status === "ready"
                    ? "Prochains passages réels, récupérés depuis SNCF et AviationStack via votre serveur relais."
                    : "Horaires indicatifs affichés en secours (serveur relais indisponible pour le moment)."}
                </p>
              </div>
            </>
          )}

          {tab === "evenements" && (
            <>
              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: "8px 0 4px" }}>
                Événements à venir — {city.label}
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 14px" }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background:
                      liveEvents.status === "ready" ? "#3E8E8A" : liveEvents.status === "error" ? "#D9635A" : "#6D757B",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 11.5, color: "#9BA3A8" }}>
                  {liveEvents.status === "loading" && "Récupération des vrais événements…"}
                  {liveEvents.status === "ready" && "Données en direct (Ticketmaster)"}
                  {liveEvents.status === "error" && "Serveur injoignable — exemples affichés"}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(liveEvents.status === "ready" ? liveEvents.events : city.events).map((ev, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#1D2124",
                      border: "1px solid #262B2F",
                      borderRadius: 14,
                      padding: "13px 14px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{ev.name}</div>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          flexShrink: 0,
                          color: "#3E8E8A",
                          background: "rgba(62,142,138,0.14)",
                        }}
                      >
                        {ev.category || ev.impact || "Événement"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "#9BA3A8", marginTop: 6 }}>
                      {ev.date} {ev.time ? `· ${ev.time}` : ""}
                    </div>
                    <div style={{ fontSize: 12.5, color: "#9BA3A8", marginTop: 2 }}>
                      {ev.venue || ev.zone}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16, padding: "10px 12px", background: "#1D2124", borderRadius: 10, border: "1px solid #262B2F" }}>
                <Info size={15} color="#6D757B" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: 11.5, color: "#6D757B", lineHeight: 1.5 }}>
                  {liveEvents.status === "ready"
                    ? "Concerts, sport, théâtre et festivals à venir, récupérés via Ticketmaster."
                    : "Exemples affichés en secours (serveur relais indisponible pour le moment)."}
                </p>
              </div>
            </>
          )}

          {tab === "alertes" && (
            <>
              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: "8px 0 10px" }}>
                {dayLabel === "aujourd'hui" ? "Maintenant" : "Demain"} — {city.label}, {hourLabel}
              </h2>
              {hotZones.length === 0 && (
                <p style={{ fontSize: 13, color: "#9BA3A8" }}>
                  Aucune zone en forte demande à cette heure pour {city.label}.
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                {hotZones.map((z) => (
                  <div
                    key={z.id}
                    style={{
                      background: "#1D2124",
                      border: "1px solid #262B2F",
                      borderLeft: "3px solid " + demandColor(z.score),
                      borderRadius: 10,
                      padding: "11px 14px",
                      fontSize: 13.5,
                    }}
                  >
                    Forte demande estimée à <strong>{z.name}</strong> ({z.score}/100)
                  </div>
                ))}
              </div>

              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: "0 0 10px" }}>
                À venir
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(liveEvents.status === "ready" ? liveEvents.events : city.events).slice(0, 5).map((ev, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#1D2124",
                      border: "1px solid #262B2F",
                      borderLeft: "3px solid #E8934A",
                      borderRadius: 10,
                      padding: "11px 14px",
                      fontSize: 13.5,
                    }}
                  >
                    {ev.name} — {ev.date} ({ev.venue || ev.zone})
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Barre de navigation */}
        <div
          style={{
            display: "flex",
            borderTop: "1px solid #262B2F",
            padding: "10px 8px calc(10px + env(safe-area-inset-bottom, 0px))",
            background: "#14171A",
          }}
        >
          {[
            { key: "demande", label: "Demande", Icon: MapPin },
            { key: "arrivees", label: "Trafic", Icon: TrainFront },
            { key: "evenements", label: "Événements", Icon: CalendarDays },
            { key: "alertes", label: "Alertes", Icon: Bell, badge: hotZones.length },
          ].map(({ key, label, Icon, badge }) => (
            <button
              key={key}
              className="navbtn"
              onClick={() => setTab(key)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: tab === key ? "#E8934A" : "#6D757B",
                position: "relative",
              }}
            >
              <Icon size={19} />
              <span style={{ fontSize: 10.5 }}>{label}</span>
              {badge > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -2,
                    right: "28%",
                    background: "#E8934A",
                    color: "#14171A",
                    borderRadius: 999,
                    fontSize: 9.5,
                    fontWeight: 700,
                    minWidth: 14,
                    height: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 3px",
                  }}
                >
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
