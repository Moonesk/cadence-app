import { useState, useMemo, useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, AttributionControl } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import logoSrc from "./assets/logo.png";
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
  List,
  Map as MapIcon,
  CalendarClock,
  User,
  Car,
  BarChart3,
  Settings,
  ChevronRight,
  ShieldCheck,
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
  business: Building2,
  station: TrainFront,
  nightlife: PartyPopper,
  leisure: Sparkles,
};

// Couleur pleine par catégorie — badges vifs façon appli premium,
// indépendants du score de demande (qui garde son propre dégradé).
const TYPE_COLORS = {
  airport: "#4C8DFF", // bleu
  station: "#2FD480", // vert
  business: "#8C6FF7", // violet
  nightlife: "#FF6FA5", // rose
  leisure: "#FF9F43", // orange
};

function eventCategoryColor(category) {
  const c = (category || "").toLowerCase();
  if (c.includes("sport")) return "#4C8DFF";
  if (c.includes("musi") || c.includes("concert")) return "#8C6FF7";
  if (c.includes("thé") || c.includes("theatre") || c.includes("arts")) return "#FF6FA5";
  if (c.includes("film") || c.includes("cinéma")) return "#2FD480";
  return "#FF9F43";
}

/* ---------------------------------------------------------
   Modèles génériques de pics par type de zone — utilisés pour
   générer rapidement les courbes des nouvelles villes, en
   attendant un éventuel réglage fin ville par ville.
--------------------------------------------------------- */
const AIRPORT_WD = [{ c: 6, w: 1.4, h: 48 }, { c: 21, w: 1.4, h: 50 }];
const AIRPORT_WE = [{ c: 7, w: 1.6, h: 40 }, { c: 21, w: 1.6, h: 42 }];
const STATION_WD = [{ c: 8, w: 1, h: 62 }, { c: 18, w: 1, h: 58 }];
const STATION_WE = [{ c: 11, w: 2, h: 34 }];
const BUSINESS_WD = [{ c: 8, w: 1, h: 55 }, { c: 18, w: 1, h: 55 }];
const BUSINESS_WE = [{ c: 14, w: 3, h: 12 }];
const NIGHTLIFE_WD = [{ c: 23, w: 1.4, h: 32 }];
const NIGHTLIFE_WE = [{ c: 23, w: 1.8, h: 75 }, { c: 1, w: 1.4, h: 52 }];
const LEISURE_WD = [{ c: 13, w: 2, h: 28 }, { c: 19, w: 2, h: 28 }];
const LEISURE_WE = [{ c: 15, w: 3, h: 46 }];

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
      { id: "cdg", name: "Roissy CDG", type: "airport", baseline: 10, lat: 49.0097, lon: 2.5479,
        weekday: [{ c: 6, w: 1.4, h: 55 }, { c: 22, w: 1.4, h: 58 }],
        weekend: [{ c: 7, w: 1.6, h: 48 }, { c: 22, w: 1.6, h: 52 }] },
      { id: "gares", name: "Gare du Nord / Gare de Lyon", type: "station", baseline: 14, lat: 48.862, lon: 2.365,
        weekday: [{ c: 8, w: 1.1, h: 68 }, { c: 18, w: 1.1, h: 62 }],
        weekend: [{ c: 11, w: 2, h: 38 }, { c: 19, w: 2, h: 42 }] },
      { id: "defense", name: "La Défense", type: "business", baseline: 6, lat: 48.8918, lon: 2.236,
        weekday: [{ c: 8, w: 1, h: 75 }, { c: 18, w: 1, h: 80 }],
        weekend: [{ c: 14, w: 3, h: 12 }] },
      { id: "bastille", name: "Bastille / Oberkampf", type: "nightlife", baseline: 8, lat: 48.8532, lon: 2.3692,
        weekday: [{ c: 23, w: 1.4, h: 32 }],
        weekend: [{ c: 23, w: 1.8, h: 82 }, { c: 1, w: 1.4, h: 58 }] },
      { id: "champs", name: "Champs-Élysées / Opéra", type: "leisure", baseline: 12, lat: 48.8698, lon: 2.3075,
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
      { id: "sxb", name: "Aéroport Saint-Exupéry", type: "airport", baseline: 9, lat: 45.7256, lon: 5.0811,
        weekday: [{ c: 6, w: 1.4, h: 48 }, { c: 21, w: 1.4, h: 52 }],
        weekend: [{ c: 7, w: 1.6, h: 40 }, { c: 21, w: 1.6, h: 44 }] },
      { id: "partdieu", name: "Part-Dieu", type: "station", baseline: 12, lat: 45.7602, lon: 4.8598,
        weekday: [{ c: 8, w: 1, h: 66 }, { c: 18, w: 1, h: 66 }],
        weekend: [{ c: 11, w: 2, h: 34 }] },
      { id: "confluence", name: "Confluence", type: "leisure", baseline: 10, lat: 45.7396, lon: 4.8187,
        weekday: [{ c: 13, w: 2, h: 28 }, { c: 19, w: 2, h: 32 }],
        weekend: [{ c: 15, w: 3, h: 48 }] },
      { id: "vieuxlyon", name: "Vieux Lyon / Presqu'île", type: "nightlife", baseline: 7, lat: 45.7626, lon: 4.8322,
        weekday: [{ c: 23, w: 1.4, h: 28 }],
        weekend: [{ c: 23, w: 1.8, h: 78 }, { c: 1, w: 1.4, h: 52 }] },
      { id: "gerland", name: "Gerland", type: "business", baseline: 8, lat: 45.7275, lon: 4.8264,
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
      { id: "mrs", name: "Aéroport Marseille Provence", type: "airport", baseline: 9, lat: 43.4393, lon: 5.2214,
        weekday: [{ c: 6, w: 1.4, h: 44 }, { c: 21, w: 1.4, h: 48 }],
        weekend: [{ c: 7, w: 1.6, h: 38 }, { c: 21, w: 1.6, h: 40 }] },
      { id: "stcharles", name: "Saint-Charles", type: "station", baseline: 12, lat: 43.3035, lon: 5.3805,
        weekday: [{ c: 8, w: 1, h: 62 }, { c: 18, w: 1, h: 58 }],
        weekend: [{ c: 12, w: 2, h: 34 }] },
      { id: "vieuxport", name: "Vieux-Port", type: "nightlife", baseline: 10, lat: 43.2951, lon: 5.3739,
        weekday: [{ c: 20, w: 2, h: 32 }],
        weekend: [{ c: 22, w: 2, h: 74 }, { c: 0, w: 1.4, h: 54 }] },
      { id: "prado", name: "Prado / 8e", type: "business", baseline: 8, lat: 43.2704, lon: 5.3948,
        weekday: [{ c: 8, w: 1, h: 52 }, { c: 18, w: 1, h: 52 }],
        weekend: [{ c: 14, w: 3, h: 14 }] },
      { id: "castellane", name: "Castellane", type: "leisure", baseline: 10, lat: 43.287, lon: 5.3809,
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
      { id: "blagnac", name: "Aéroport Blagnac", type: "airport", baseline: 9, lat: 43.6293, lon: 1.3638,
        weekday: [{ c: 6, w: 1.4, h: 44 }, { c: 21, w: 1.4, h: 46 }],
        weekend: [{ c: 7, w: 1.6, h: 36 }, { c: 21, w: 1.6, h: 38 }] },
      { id: "matabiau", name: "Matabiau", type: "station", baseline: 11, lat: 43.6112, lon: 1.4536,
        weekday: [{ c: 8, w: 1, h: 58 }, { c: 18, w: 1, h: 56 }],
        weekend: [{ c: 12, w: 2, h: 30 }] },
      { id: "capitole", name: "Capitole / centre-ville", type: "nightlife", baseline: 10, lat: 43.6045, lon: 1.4442,
        weekday: [{ c: 20, w: 2, h: 32 }],
        weekend: [{ c: 22, w: 2, h: 68 }, { c: 0, w: 1.4, h: 48 }] },
      { id: "compans", name: "Compans-Caffarelli", type: "business", baseline: 7, lat: 43.6103, lon: 1.4325,
        weekday: [{ c: 8, w: 1, h: 48 }, { c: 18, w: 1, h: 48 }],
        weekend: [{ c: 14, w: 3, h: 10 }] },
      { id: "stcyprien", name: "Saint-Cyprien", type: "leisure", baseline: 9, lat: 43.5985, lon: 1.4324,
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
      { id: "gare-rennes", name: "Gare de Rennes", type: "station", baseline: 12, lat: 48.1036, lon: -1.6725,
        weekday: [{ c: 8, w: 1, h: 62 }, { c: 18, w: 1, h: 60 }],
        weekend: [{ c: 12, w: 2, h: 34 }, { c: 19, w: 2, h: 32 }] },
      { id: "aeroport-rennes", name: "Aéroport Rennes - Saint-Jacques", type: "airport", baseline: 6, lat: 48.0695, lon: -1.7344,
        weekday: [{ c: 7, w: 1.4, h: 26 }, { c: 20, w: 1.4, h: 28 }],
        weekend: [{ c: 8, w: 1.6, h: 22 }, { c: 20, w: 1.6, h: 22 }] },
      { id: "sainte-anne", name: "Sainte-Anne / rue de la Soif", type: "nightlife", baseline: 8, lat: 48.1147, lon: -1.6799,
        weekday: [{ c: 23, w: 1.4, h: 34 }],
        weekend: [{ c: 23, w: 1.8, h: 80 }, { c: 1, w: 1.4, h: 56 }] },
      { id: "beaulieu", name: "Beaulieu (campus)", type: "business", baseline: 7, lat: 48.1174, lon: -1.6407,
        weekday: [{ c: 8, w: 1, h: 48 }, { c: 17, w: 1.2, h: 44 }],
        weekend: [{ c: 14, w: 3, h: 10 }] },
      { id: "colombier", name: "Colombier / centre commercial", type: "leisure", baseline: 9, lat: 48.1039, lon: -1.6832,
        weekday: [{ c: 13, w: 2, h: 26 }, { c: 18, w: 2, h: 24 }],
        weekend: [{ c: 15, w: 3, h: 42 }] },
    ],
    events: [
      { name: "Match au Roazhon Park", date: "sam. 19 sept. 2026", time: "17h00", zone: "Roazhon Park", impact: "Fort" },
      { name: "Concert au Liberté", date: "ven. 25 sept. 2026", time: "20h00", zone: "Centre-ville", impact: "Moyen" },
    ],
  },
  nice: {
    label: "Nice",
    lat: 43.7102, lon: 7.2620,
    zones: [
      { id: "aeroport-nice", name: "Aéroport Nice Côte d'Azur", type: "airport", baseline: 11, lat: 43.6584, lon: 7.2159, weekday: AIRPORT_WD, weekend: AIRPORT_WE },
      { id: "gare-nice", name: "Nice Ville", type: "station", baseline: 12, lat: 43.7047, lon: 7.262, weekday: STATION_WD, weekend: STATION_WE },
      { id: "vieux-nice", name: "Vieux Nice / Promenade des Anglais", type: "nightlife", baseline: 9, lat: 43.6959, lon: 7.2762, weekday: NIGHTLIFE_WD, weekend: NIGHTLIFE_WE },
      { id: "affaires-nice", name: "Quartier d'affaires", type: "business", baseline: 6, lat: 43.7, lon: 7.25, weekday: BUSINESS_WD, weekend: BUSINESS_WE },
      { id: "commercial-nice", name: "Nice Étoile / centre commercial", type: "leisure", baseline: 10, lat: 43.6995, lon: 7.273, weekday: LEISURE_WD, weekend: LEISURE_WE },
    ],
    events: [],
  },
  cannes: {
    label: "Cannes",
    lat: 43.5528, lon: 7.0174,
    zones: [
      { id: "gare-cannes", name: "Cannes", type: "station", baseline: 10, lat: 43.5511, lon: 7.0181, weekday: STATION_WD, weekend: STATION_WE },
      { id: "croisette", name: "La Croisette", type: "nightlife", baseline: 11, lat: 43.5495, lon: 7.0189, weekday: NIGHTLIFE_WD, weekend: NIGHTLIFE_WE },
      { id: "palais-festivals", name: "Palais des Festivals", type: "leisure", baseline: 10, lat: 43.5498, lon: 7.017, weekday: LEISURE_WD, weekend: LEISURE_WE },
    ],
    events: [],
  },
  antibes: {
    label: "Antibes",
    lat: 43.5804, lon: 7.1251,
    zones: [
      { id: "gare-antibes", name: "Antibes", type: "station", baseline: 9, lat: 43.581, lon: 7.1219, weekday: STATION_WD, weekend: STATION_WE },
      { id: "vieil-antibes", name: "Vieil Antibes / Port Vauban", type: "nightlife", baseline: 9, lat: 43.5804, lon: 7.1251, weekday: NIGHTLIFE_WD, weekend: NIGHTLIFE_WE },
      { id: "bord-de-mer-antibes", name: "Bord de mer / Marineland", type: "leisure", baseline: 9, lat: 43.605, lon: 7.1, weekday: LEISURE_WD, weekend: LEISURE_WE },
    ],
    events: [],
  },
  monaco: {
    label: "Monaco",
    lat: 43.7384, lon: 7.4246,
    zones: [
      { id: "gare-monaco", name: "Monaco-Monte-Carlo", type: "station", baseline: 10, lat: 43.7396, lon: 7.4276, weekday: STATION_WD, weekend: STATION_WE },
      { id: "monte-carlo", name: "Monte-Carlo / Casino", type: "nightlife", baseline: 13, lat: 43.7396, lon: 7.4297, weekday: NIGHTLIFE_WD, weekend: NIGHTLIFE_WE },
      { id: "port-hercule", name: "Port Hercule / Fontvieille", type: "business", baseline: 9, lat: 43.7325, lon: 7.423, weekday: BUSINESS_WD, weekend: BUSINESS_WE },
    ],
    events: [],
  },
  nantes: {
    label: "Nantes",
    lat: 47.2184, lon: -1.5536,
    zones: [
      { id: "aeroport-nantes", name: "Aéroport Nantes Atlantique", type: "airport", baseline: 9, lat: 47.1532, lon: -1.6108, weekday: AIRPORT_WD, weekend: AIRPORT_WE },
      { id: "gare-nantes", name: "Nantes", type: "station", baseline: 12, lat: 47.2173, lon: -1.5423, weekday: STATION_WD, weekend: STATION_WE },
      { id: "bouffay", name: "Bouffay / centre historique", type: "nightlife", baseline: 8, lat: 47.2137, lon: -1.554, weekday: NIGHTLIFE_WD, weekend: NIGHTLIFE_WE },
      { id: "euronantes", name: "Quartier d'affaires - Euronantes", type: "business", baseline: 7, lat: 47.211, lon: -1.539, weekday: BUSINESS_WD, weekend: BUSINESS_WE },
      { id: "ile-de-nantes", name: "Île de Nantes / Les Machines", type: "leisure", baseline: 9, lat: 47.207, lon: -1.546, weekday: LEISURE_WD, weekend: LEISURE_WE },
    ],
    events: [],
  },
  strasbourg: {
    label: "Strasbourg",
    lat: 48.5734, lon: 7.7521,
    zones: [
      { id: "aeroport-strasbourg", name: "Aéroport de Strasbourg", type: "airport", baseline: 7, lat: 48.5383, lon: 7.6282, weekday: AIRPORT_WD, weekend: AIRPORT_WE },
      { id: "gare-strasbourg", name: "Strasbourg", type: "station", baseline: 12, lat: 48.5851, lon: 7.7347, weekday: STATION_WD, weekend: STATION_WE },
      { id: "petite-france", name: "Petite France / centre-ville", type: "nightlife", baseline: 9, lat: 48.581, lon: 7.746, weekday: NIGHTLIFE_WD, weekend: NIGHTLIFE_WE },
      { id: "institutions-europeennes", name: "Quartier des institutions européennes", type: "business", baseline: 7, lat: 48.596, lon: 7.769, weekday: BUSINESS_WD, weekend: BUSINESS_WE },
      { id: "commercial-strasbourg", name: "Zone commerciale", type: "leisure", baseline: 9, lat: 48.573, lon: 7.75, weekday: LEISURE_WD, weekend: LEISURE_WE },
    ],
    events: [],
  },
  bordeaux: {
    label: "Bordeaux",
    lat: 44.8378, lon: -0.5792,
    zones: [
      { id: "aeroport-bordeaux", name: "Aéroport de Bordeaux-Mérignac", type: "airport", baseline: 9, lat: 44.8283, lon: -0.7156, weekday: AIRPORT_WD, weekend: AIRPORT_WE },
      { id: "gare-bordeaux", name: "Bordeaux Saint-Jean", type: "station", baseline: 12, lat: 44.8256, lon: -0.5563, weekday: STATION_WD, weekend: STATION_WE },
      { id: "quais-bordeaux", name: "Quais de Bordeaux / centre-ville", type: "nightlife", baseline: 9, lat: 44.8407, lon: -0.57, weekday: NIGHTLIFE_WD, weekend: NIGHTLIFE_WE },
      { id: "affaires-bordeaux", name: "Quartier d'affaires", type: "business", baseline: 7, lat: 44.845, lon: -0.56, weekday: BUSINESS_WD, weekend: BUSINESS_WE },
      { id: "cite-du-vin", name: "Cité du Vin / Bassins à flot", type: "leisure", baseline: 8, lat: 44.8624, lon: -0.551, weekday: LEISURE_WD, weekend: LEISURE_WE },
    ],
    events: [],
  },
  lille: {
    label: "Lille",
    lat: 50.6292, lon: 3.0573,
    zones: [
      { id: "aeroport-lille", name: "Aéroport de Lille-Lesquin", type: "airport", baseline: 7, lat: 50.5619, lon: 3.0894, weekday: AIRPORT_WD, weekend: AIRPORT_WE },
      { id: "gare-lille", name: "Lille Europe", type: "station", baseline: 13, lat: 50.6396, lon: 3.0755, weekday: STATION_WD, weekend: STATION_WE },
      { id: "vieux-lille", name: "Vieux Lille", type: "nightlife", baseline: 9, lat: 50.6386, lon: 3.062, weekday: NIGHTLIFE_WD, weekend: NIGHTLIFE_WE },
      { id: "euralille", name: "Quartier d'affaires - Euralille", type: "business", baseline: 8, lat: 50.637, lon: 3.076, weekday: BUSINESS_WD, weekend: BUSINESS_WE },
      { id: "commercial-lille", name: "Zone commerciale", type: "leisure", baseline: 9, lat: 50.627, lon: 3.057, weekday: LEISURE_WD, weekend: LEISURE_WE },
    ],
    events: [],
  },
  montpellier: {
    label: "Montpellier",
    lat: 43.6108, lon: 3.8767,
    zones: [
      { id: "aeroport-montpellier", name: "Aéroport de Montpellier-Méditerranée", type: "airport", baseline: 7, lat: 43.5762, lon: 3.963, weekday: AIRPORT_WD, weekend: AIRPORT_WE },
      { id: "gare-montpellier", name: "Montpellier Saint-Roch", type: "station", baseline: 11, lat: 43.6045, lon: 3.8807, weekday: STATION_WD, weekend: STATION_WE },
      { id: "ecusson", name: "L'Écusson / centre historique", type: "nightlife", baseline: 9, lat: 43.611, lon: 3.877, weekday: NIGHTLIFE_WD, weekend: NIGHTLIFE_WE },
      { id: "antigone", name: "Antigone / quartier d'affaires", type: "business", baseline: 7, lat: 43.607, lon: 3.887, weekday: BUSINESS_WD, weekend: BUSINESS_WE },
      { id: "commercial-montpellier", name: "Zone commerciale", type: "leisure", baseline: 8, lat: 43.607, lon: 3.913, weekday: LEISURE_WD, weekend: LEISURE_WE },
    ],
    events: [],
  },
  grenoble: {
    label: "Grenoble",
    lat: 45.1885, lon: 5.7245,
    zones: [
      { id: "aeroport-grenoble", name: "Aéroport Grenoble-Alpes-Isère", type: "airport", baseline: 6, lat: 45.3629, lon: 5.3294, weekday: AIRPORT_WD, weekend: AIRPORT_WE },
      { id: "gare-grenoble", name: "Grenoble", type: "station", baseline: 10, lat: 45.1916, lon: 5.7142, weekday: STATION_WD, weekend: STATION_WE },
      { id: "centre-grenoble", name: "Centre-ville", type: "nightlife", baseline: 8, lat: 45.1885, lon: 5.7245, weekday: NIGHTLIFE_WD, weekend: NIGHTLIFE_WE },
      { id: "presquile", name: "Presqu'île scientifique / affaires", type: "business", baseline: 7, lat: 45.2015, lon: 5.71, weekday: BUSINESS_WD, weekend: BUSINESS_WE },
      { id: "commercial-grenoble", name: "Zone commerciale", type: "leisure", baseline: 8, lat: 45.17, lon: 5.73, weekday: LEISURE_WD, weekend: LEISURE_WE },
    ],
    events: [],
  },
  toulon: {
    label: "Toulon",
    lat: 43.1242, lon: 5.9280,
    zones: [
      { id: "aeroport-toulon", name: "Aéroport Toulon-Hyères", type: "airport", baseline: 6, lat: 43.0973, lon: 6.146, weekday: AIRPORT_WD, weekend: AIRPORT_WE },
      { id: "gare-toulon", name: "Toulon", type: "station", baseline: 10, lat: 43.1249, lon: 5.931, weekday: STATION_WD, weekend: STATION_WE },
      { id: "port-toulon", name: "Centre-ville / port", type: "nightlife", baseline: 8, lat: 43.1242, lon: 5.928, weekday: NIGHTLIFE_WD, weekend: NIGHTLIFE_WE },
      { id: "affaires-toulon", name: "Quartier d'affaires", type: "business", baseline: 6, lat: 43.13, lon: 5.935, weekday: BUSINESS_WD, weekend: BUSINESS_WE },
      { id: "commercial-toulon", name: "Zone commerciale", type: "leisure", baseline: 8, lat: 43.135, lon: 5.92, weekday: LEISURE_WD, weekend: LEISURE_WE },
    ],
    events: [],
  },
  reims: {
    label: "Reims",
    lat: 49.2583, lon: 4.0317,
    zones: [
      { id: "gare-reims", name: "Reims", type: "station", baseline: 10, lat: 49.2603, lon: 4.0245, weekday: STATION_WD, weekend: STATION_WE },
      { id: "centre-reims", name: "Centre-ville", type: "nightlife", baseline: 8, lat: 49.2583, lon: 4.0317, weekday: NIGHTLIFE_WD, weekend: NIGHTLIFE_WE },
      { id: "affaires-reims", name: "Quartier d'affaires", type: "business", baseline: 6, lat: 49.25, lon: 4.035, weekday: BUSINESS_WD, weekend: BUSINESS_WE },
      { id: "commercial-reims", name: "Zone commerciale", type: "leisure", baseline: 8, lat: 49.245, lon: 4.04, weekday: LEISURE_WD, weekend: LEISURE_WE },
    ],
    events: [],
  },
  "saint-etienne": {
    label: "Saint-Étienne",
    lat: 45.4397, lon: 4.3872,
    zones: [
      { id: "gare-st-etienne", name: "Saint-Étienne Châteaucreux", type: "station", baseline: 9, lat: 45.4406, lon: 4.4046, weekday: STATION_WD, weekend: STATION_WE },
      { id: "centre-st-etienne", name: "Centre-ville", type: "nightlife", baseline: 7, lat: 45.4397, lon: 4.3872, weekday: NIGHTLIFE_WD, weekend: NIGHTLIFE_WE },
      { id: "affaires-st-etienne", name: "Quartier d'affaires", type: "business", baseline: 6, lat: 45.435, lon: 4.39, weekday: BUSINESS_WD, weekend: BUSINESS_WE },
      { id: "commercial-st-etienne", name: "Zone commerciale", type: "leisure", baseline: 7, lat: 45.43, lon: 4.395, weekday: LEISURE_WD, weekend: LEISURE_WE },
    ],
    events: [],
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
  nice: "Nice Ville",
  cannes: "Cannes",
  antibes: "Antibes",
  monaco: "Monaco-Monte-Carlo",
  nantes: "Nantes",
  strasbourg: "Strasbourg",
  bordeaux: "Bordeaux Saint-Jean",
  lille: "Lille Europe",
  montpellier: "Montpellier Saint-Roch",
  grenoble: "Grenoble",
  toulon: "Toulon",
  reims: "Reims",
  "saint-etienne": "Saint-Étienne Châteaucreux",
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
const COOL = [47, 212, 128]; // #2FD480 — vert vif, faible demande
const WARM = [255, 92, 74]; // #FF5C4A — rouge-orangé vif, forte demande
function demandColor(score) {
  const t = Math.min(1, Math.max(0, score / 100));
  const rgb = COOL.map((c, i) => Math.round(c + (WARM[i] - c) * t));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/* ---------------------------------------------------------
   Planning hebdomadaire optimal — pour chaque heure d'un
   créneau de travail, on trouve la zone la plus demandée,
   puis on regroupe les heures consécutives ayant la même
   meilleure zone en un seul créneau lisible.
--------------------------------------------------------- */
const DAYS_OF_WEEK = [
  { key: "lundi", label: "Lun", full: "Lundi", dayType: "weekday" },
  { key: "mardi", label: "Mar", full: "Mardi", dayType: "weekday" },
  { key: "mercredi", label: "Mer", full: "Mercredi", dayType: "weekday" },
  { key: "jeudi", label: "Jeu", full: "Jeudi", dayType: "weekday" },
  { key: "vendredi", label: "Ven", full: "Vendredi", dayType: "weekday" },
  { key: "samedi", label: "Sam", full: "Samedi", dayType: "weekend" },
  { key: "dimanche", label: "Dim", full: "Dimanche", dayType: "weekend" },
];

function getTopZoneForHour(zones, dayType, hour) {
  let best = null;
  zones.forEach((z) => {
    const curve = dayType === "weekday" ? z.curveWeekday : z.curveWeekend;
    const score = curve[hour];
    if (!best || score > best.score) best = { id: z.id, name: z.name, type: z.type, score };
  });
  return best;
}

function buildDaySegments(zones, dayType, startHour, endHour) {
  const hours = [];
  if (startHour <= endHour) {
    for (let h = startHour; h <= endHour; h++) hours.push(h);
  } else {
    // Créneau qui passe minuit (ex. 20h -> 3h)
    for (let h = startHour; h <= 23; h++) hours.push(h);
    for (let h = 0; h <= endHour; h++) hours.push(h);
  }
  const segments = [];
  hours.forEach((h) => {
    const top = getTopZoneForHour(zones, dayType, h);
    const last = segments[segments.length - 1];
    if (last && last.zoneId === top.id) {
      last.endHour = h;
      last.scores.push(top.score);
    } else {
      segments.push({
        zoneId: top.id,
        name: top.name,
        type: top.type,
        startHour: h,
        endHour: h,
        scores: [top.score],
      });
    }
  });
  return segments.map((s) => ({
    ...s,
    avgScore: Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length),
  }));
}

function formatHour(h) {
  return `${String(h).padStart(2, "0")}h`;
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

// Clé TomTom pour la couche trafic routier en direct — clé "publique"
// par conception (protégée par liste de domaines autorisés côté TomTom,
// pas par le secret), donc normal qu'elle soit visible ici.
const TOMTOM_KEY = "VOTRE_CLE_TOMTOM";

function DemandMap({ zones, center, onZoneClick }) {
  const [showTraffic, setShowTraffic] = useState(true);
  return (
    <div
      style={{
        position: "relative",
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid #2B3564",
        marginBottom: 16,
        height: 260,
      }}
    >
      <button
        onClick={() => setShowTraffic((v) => !v)}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 500,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          padding: "7px 11px",
          borderRadius: 999,
          border: "1px solid " + (showTraffic ? "#FF9F43" : "#2B3564"),
          background: showTraffic ? "#FF9F43" : "#0B0F24",
          color: showTraffic ? "#0B0F24" : "#F3F5FF",
          boxShadow: "0 3px 10px rgba(0,0,0,0.45)",
          cursor: "pointer",
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: showTraffic ? "#0B0F24" : "#5B6396" }} />
        Trafic routier
      </button>
      <MapContainer
        center={center}
        zoom={12}
        style={{ width: "100%", height: "100%", background: "#141A38" }}
        scrollWheelZoom={false}
        attributionControl={false}
        key={`${center[0]}-${center[1]}`}
      >
        <AttributionControl position="bottomright" prefix={false} />
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <TileLayer
          url={`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${TOMTOM_KEY}`}
          opacity={showTraffic ? 0.75 : 0}
        />
        {zones.map((z) => (
          <CircleMarker
            key={z.id}
            center={[z.lat, z.lon]}
            radius={8 + (z.score / 100) * 10}
            pathOptions={{
              color: demandColor(z.score),
              fillColor: demandColor(z.score),
              fillOpacity: 0.65,
              weight: 2,
            }}
            eventHandlers={{ click: () => onZoneClick && onZoneClick(z) }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {z.name} — {z.score}/100
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
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
  const [isOnline, setIsOnline] = useState(true);
  const [planningSchedule, setPlanningSchedule] = useState(() => {
    const obj = {};
    DAYS_OF_WEEK.forEach((d, i) => {
      obj[d.key] = { enabled: i < 5, start: 8, end: 20 }; // Lun-Ven activés par défaut
    });
    return obj;
  });
  const [demandView, setDemandView] = useState("map"); // "map" | "list"
  const [trafficMode, setTrafficMode] = useState("arrivals"); // "arrivals" | "departures"
  const [trafficStartHour, setTrafficStartHour] = useState(0);
  const [trafficEndHour, setTrafficEndHour] = useState(23);
  const [liveTraffic, setLiveTraffic] = useState({ status: "idle", trains: [], flights: [], flightsAvailable: true });

  const trafficDate = useMemo(() => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }, [now]);

  useEffect(() => {
    if (tab !== "arrivees") return;
    let cancelled = false;
    setLiveTraffic({ status: "loading", trains: [], flights: [], flightsAvailable: true });
    const station = STATION_NAMES[cityKey];
    Promise.allSettled([
      fetch(
        `${SERVER_BASE_URL}/api/trains?station=${encodeURIComponent(station)}&kind=${trafficMode}&date=${trafficDate}&startHour=${trafficStartHour}&endHour=${trafficEndHour}`
      ).then((r) => r.json()),
      fetch(`${SERVER_BASE_URL}/api/flights?city=${cityKey}&kind=${trafficMode}&date=${trafficDate}`).then((r) =>
        r.json()
      ),
    ]).then(([trainsSettled, flightsSettled]) => {
      if (cancelled) return;
      const trainsOk = trainsSettled.status === "fulfilled" && !trainsSettled.value.error;
      const flightsOk = flightsSettled.status === "fulfilled" && !flightsSettled.value.error;
      if (trainsOk) {
        setLiveTraffic({
          status: "ready",
          trains: trainsSettled.value.result || [],
          flights: flightsOk ? flightsSettled.value.result || [] : [],
          flightsAvailable: flightsOk,
        });
      } else {
        setLiveTraffic({ status: "error", trains: [], flights: [], flightsAvailable: false });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tab, cityKey, trafficMode, trafficDate, trafficStartHour, trafficEndHour]);

  // Filtre par plage horaire choisie (côté appli, sur les données déjà reçues)
  const filterByHourRange = (items) =>
    items.filter((it) => {
      const h = Number((it.time || "00:00").slice(0, 2));
      return trafficStartHour <= trafficEndHour
        ? h >= trafficStartHour && h <= trafficEndHour
        : h >= trafficStartHour || h <= trafficEndHour;
    });
  const visibleTrains = filterByHourRange(liveTraffic.trains);
  const visibleFlights = filterByHourRange(liveTraffic.flights);

  const [liveEvents, setLiveEvents] = useState({ status: "idle", events: [] });

  // Panneau de détail affiché au clic sur une zone (carte ou liste)
  const [selectedZone, setSelectedZone] = useState(null);
  const [zoneDetail, setZoneDetail] = useState({ status: "idle", trains: [], flights: [], events: [] });

  const demandDateStr = useMemo(() => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, [now, dayOffset]);

  function isNearHour(itemTime, targetHour, window = 1) {
    const h = Number((itemTime || "00:00").slice(0, 2));
    let diff = Math.abs(h - targetHour);
    diff = Math.min(diff, 24 - diff);
    return diff <= window;
  }

  async function openZoneDetail(zone) {
    setSelectedZone(zone);
    setZoneDetail({ status: "loading", trains: [], flights: [], events: [] });
    try {
      if (zone.type === "airport") {
        const res = await fetch(
          `${SERVER_BASE_URL}/api/flights?city=${cityKey}&kind=arrivals&date=${demandDateStr}`
        ).then((r) => r.json());
        if (res.error) throw new Error(res.error);
        const flights = (res.result || []).filter((f) => isNearHour(f.time, hour));
        setZoneDetail({ status: "ready", trains: [], flights, events: [] });
      } else if (zone.type === "station") {
        const station = STATION_NAMES[cityKey];
        const res = await fetch(
          `${SERVER_BASE_URL}/api/trains?station=${encodeURIComponent(station)}&kind=arrivals&date=${demandDateStr}`
        ).then((r) => r.json());
        if (res.error) throw new Error(res.error);
        const trains = (res.result || []).filter((t) => isNearHour(t.time, hour));
        setZoneDetail({ status: "ready", trains, flights: [], events: [] });
      } else {
        // Zones affaires / vie nocturne / loisirs -> événements de la ville ce jour-là
        const res = await fetch(`${SERVER_BASE_URL}/api/events?city=${cityKey}`).then((r) => r.json());
        if (res.error) throw new Error(res.error);
        setZoneDetail({ status: "ready", trains: [], flights: [], events: res.result || [] });
      }
    } catch {
      setZoneDetail({ status: "error", trains: [], flights: [], events: [] });
    }
  }

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
        height: "100dvh",
        background: "radial-gradient(circle at 50% 0%, #16204A 0%, #080B1D 60%)",
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
          background: #3A4578;
          border-radius: 2px;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px; height: 16px; border-radius: 50%;
          background: #4C8DFF;
          border: 2px solid #0B0F24;
          cursor: pointer;
          margin-top: -6.5px;
        }
        .leaflet-control-attribution {
          font-size: 8px !important;
          background: rgba(255,255,255,0.55) !important;
          color: #555 !important;
          padding: 0 4px !important;
          line-height: 1.6 !important;
          border-radius: 4px 0 0 0 !important;
        }
        .leaflet-control-attribution a { color: #555 !important; }
      `}</style>

      {/* Cadre "téléphone" */}
      <div
        style={{
          width: 390,
          maxWidth: "100%",
          background: "linear-gradient(160deg, #131A3D 0%, #0A0E22 55%, #0B0F24 100%)",
          borderRadius: 28,
          border: "1px solid #2B3564",
          boxShadow: "0 30px 80px -20px rgba(76,141,255,0.25)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          color: "#F3F5FF",
          position: "relative",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 18px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img
                src={logoSrc}
                alt="Cadence"
                style={{ width: 68, height: 68, borderRadius: 16, flexShrink: 0 }}
              />
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", lineHeight: 1.1 }}>
                <span
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: 700,
                    fontSize: 21,
                    letterSpacing: "-0.01em",
                    background: "linear-gradient(90deg, #F3F5FF, #A9C0FF)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  Cadence
                </span>
                <span
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: 600,
                    fontSize: 9.5,
                    letterSpacing: "0.08em",
                    color: "#5B6396",
                    marginTop: 1,
                  }}
                >
                  VTC &amp; TAXI
                </span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {["demande", "planning"].includes(tab) && (
                <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, color: "#8A92C2" }}>
                  {hourLabel}
                </span>
              )}
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#2FD480",
                  background: "rgba(47,212,128,0.14)",
                  border: "1px solid rgba(47,212,128,0.3)",
                  borderRadius: 999,
                  padding: "4px 9px",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#2FD480" }} />
                En ligne
              </span>
            </div>
          </div>
          <p style={{ margin: "2px 0 14px", fontSize: 13, color: "#8A92C2" }}>
            Où et quand la demande est forte
          </p>

          {/* Recherche de ville */}
          <div style={{ position: "relative" }}>
            <div style={{ position: "relative" }}>
              <Search
                size={15}
                color="#5B6396"
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
                  border: "1px solid #3A4578",
                  background: "#141A38",
                  color: "#F3F5FF",
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
                  background: "#141A38",
                  border: "1px solid #3A4578",
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
                        color: "#F3F5FF",
                        fontSize: 13.5,
                        cursor: "pointer",
                      }}
                    >
                      {c.label}
                    </button>
                  ))
                ) : (
                  <div style={{ padding: "10px 12px", fontSize: 12.5, color: "#8A92C2" }}>
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
              {/* Profil + statut */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, #4C8DFF, #6F5CFF)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <User size={20} color="#F3F5FF" />
                  </div>
                  <div>
                    <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15 }}>
                      {hour < 18 ? "Bonjour" : "Bonsoir"}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#8A92C2" }}>Bonne route !</div>
                  </div>
                </div>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "#C7CDF0",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid #2B3564",
                    borderRadius: 999,
                    padding: "6px 10px",
                  }}
                >
                  <Car size={13} /> VTC / Taxi
                </span>
              </div>

              {/* Toggle En ligne + ville */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button
                  onClick={() => setIsOnline((v) => !v)}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 14px",
                    borderRadius: 999,
                    border: "1px solid " + (isOnline ? "rgba(47,212,128,0.4)" : "#2B3564"),
                    background: isOnline
                      ? "linear-gradient(90deg, rgba(47,212,128,0.22), rgba(47,212,128,0.08))"
                      : "rgba(255,255,255,0.04)",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: isOnline ? "#2FD480" : "#5B6396",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600, color: isOnline ? "#2FD480" : "#8A92C2" }}>
                    {isOnline ? "En ligne" : "Hors ligne"}
                  </span>
                </button>
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 14px",
                    borderRadius: 999,
                    border: "1px solid #2B3564",
                    background: "rgba(76,141,255,0.10)",
                  }}
                >
                  <MapPin size={15} color="#4C8DFF" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#F3F5FF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {city.label}
                  </span>
                </div>
              </div>

              {/* Bannière ville */}
              <div
                style={{
                  position: "relative",
                  borderRadius: 18,
                  overflow: "hidden",
                  marginBottom: 16,
                  padding: "18px 18px",
                  background: "linear-gradient(120deg, #24316E 0%, #17204A 55%, #0F1533 100%)",
                  border: "1px solid #2B3564",
                }}
              >
                <svg
                  width="180"
                  height="180"
                  viewBox="0 0 180 180"
                  style={{ position: "absolute", top: -40, right: -40, opacity: 0.5 }}
                >
                  <circle cx="90" cy="90" r="90" fill="url(#heroGlow)" />
                  <defs>
                    <radialGradient id="heroGlow">
                      <stop offset="0%" stopColor="#4C8DFF" stopOpacity="0.55" />
                      <stop offset="100%" stopColor="#4C8DFF" stopOpacity="0" />
                    </radialGradient>
                  </defs>
                </svg>
                <div style={{ position: "relative" }}>
                  <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 20, marginBottom: 4 }}>
                    {city.label}
                  </div>
                  <div style={{ fontSize: 12.5, color: "#C7CDF0", marginBottom: 12 }}>
                    Des courses en toute sérénité
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <ShieldCheck size={13} color="#2FD480" />
                    <span style={{ fontSize: 11, color: "#C7CDF0" }}>Sécurité • Confort • Satisfaction</span>
                  </div>
                </div>
              </div>

              {/* Prochains repères */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#2FD480" }} />
                  <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 14.5 }}>
                    Zones à surveiller
                  </span>
                </div>
                <button
                  onClick={() => setDemandView("list")}
                  style={{ display: "flex", alignItems: "center", gap: 2, background: "none", border: "none", color: "#4C8DFF", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  Voir tout <ChevronRight size={13} />
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
                {zonesScored.slice(0, 4).map((z) => {
                  const Icon = ICONS[z.type];
                  const typeLabels = { airport: "Aéroport", station: "Gare", business: "Affaires", nightlife: "Vie nocturne", leisure: "Loisirs" };
                  return (
                    <div
                      key={z.id}
                      onClick={() => openZoneDetail(z)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        background: "#141A38",
                        border: "1px solid #2B3564",
                        borderRadius: 14,
                        padding: "10px 12px",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 11,
                          background: TYPE_COLORS[z.type],
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Icon size={16} color="#0B0F24" strokeWidth={2.3} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <span
                            style={{
                              fontSize: 9.5,
                              fontWeight: 700,
                              color: TYPE_COLORS[z.type],
                              background: `${TYPE_COLORS[z.type]}22`,
                              borderRadius: 999,
                              padding: "2px 7px",
                            }}
                          >
                            {typeLabels[z.type]}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {z.name}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: demandColor(z.score),
                          background: `${demandColor(z.score)}22`,
                          borderRadius: 999,
                          padding: "5px 9px",
                          flexShrink: 0,
                        }}
                      >
                        {z.score >= 70 ? "Fort" : z.score >= 40 ? "Modéré" : "Calme"}
                      </span>
                      <ChevronRight size={15} color="#5B6396" style={{ flexShrink: 0 }} />
                    </div>
                  );
                })}
              </div>

              {/* Jour + heure */}
              <div
                style={{
                  background: "#141A38",
                  border: "1px solid #2B3564",
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
                        border: "1px solid " + (dayOffset === val ? "#4C8DFF" : "#3A4578"),
                        background: dayOffset === val ? "rgba(76,141,255,0.16)" : "transparent",
                        color: dayOffset === val ? "#4C8DFF" : "#8A92C2",
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
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#5B6396", marginTop: 4 }}>
                  <span>00:00</span>
                  <span>12:00</span>
                  <span>23:00</span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 10px" }}>
                <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: 0 }}>
                  Demande par zone — {city.label}, {dayLabel}
                </h2>
                <div style={{ display: "flex", gap: 4, background: "#141A38", borderRadius: 8, padding: 3, border: "1px solid #2B3564" }}>
                  <button
                    onClick={() => setDemandView("map")}
                    aria-label="Vue carte"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 24,
                      borderRadius: 6,
                      border: "none",
                      background: demandView === "map" ? "rgba(76,141,255,0.18)" : "transparent",
                      color: demandView === "map" ? "#4C8DFF" : "#5B6396",
                      cursor: "pointer",
                    }}
                  >
                    <MapIcon size={14} />
                  </button>
                  <button
                    onClick={() => setDemandView("list")}
                    aria-label="Vue liste"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 24,
                      borderRadius: 6,
                      border: "none",
                      background: demandView === "list" ? "rgba(76,141,255,0.18)" : "transparent",
                      color: demandView === "list" ? "#4C8DFF" : "#5B6396",
                      cursor: "pointer",
                    }}
                  >
                    <List size={14} />
                  </button>
                </div>
              </div>

              {demandView === "map" && (
                <DemandMap zones={zonesScored} center={[city.lat, city.lon]} onZoneClick={openZoneDetail} />
              )}

              {demandView === "list" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {zonesScored.map((z) => {
                  const Icon = ICONS[z.type];
                  return (
                    <div
                      key={z.id}
                      onClick={() => openZoneDetail(z)}
                      style={{
                        background: "#141A38",
                        border: "1px solid #2B3564",
                        borderRadius: 14,
                        padding: "12px 14px",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 12,
                          background: TYPE_COLORS[z.type],
                          boxShadow: `0 6px 16px -4px ${TYPE_COLORS[z.type]}66`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Icon size={18} color="#0B0F24" strokeWidth={2.3} />
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
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 16, padding: "10px 12px", background: "#141A38", borderRadius: 10, border: "1px solid #2B3564" }}>
                <Info size={15} color="#5B6396" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: 11.5, color: "#5B6396", lineHeight: 1.5 }}>
                  Estimations basées sur les tendances horaires typiques de la ville.
                </p>
              </div>
            </>
          )}

          {tab === "arrivees" && (
            <>
              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: "8px 0 4px" }}>
                Trafic gare / aéroport — {city.label}
              </h2>
              <p style={{ fontSize: 12, color: "#8A92C2", margin: "0 0 12px" }}>
                Arrivées et départs créent de la demande ponctuelle à la gare et à l'aéroport, aujourd'hui.
              </p>

              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
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
                      border: "1px solid " + (trafficMode === val ? "#4C8DFF" : "#3A4578"),
                      background: trafficMode === val ? "rgba(76,141,255,0.16)" : "transparent",
                      color: trafficMode === val ? "#4C8DFF" : "#8A92C2",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Plage horaire */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 14,
                  background: "#141A38",
                  border: "1px solid #2B3564",
                  borderRadius: 10,
                  padding: "8px 10px",
                }}
              >
                <span style={{ fontSize: 12, color: "#8A92C2", flexShrink: 0 }}>Plage horaire</span>
                <select
                  value={trafficStartHour}
                  onChange={(e) => setTrafficStartHour(Number(e.target.value))}
                  style={{
                    flex: 1,
                    padding: "6px 6px",
                    borderRadius: 6,
                    border: "1px solid #3A4578",
                    background: "#0B0F24",
                    color: "#F3F5FF",
                    fontSize: 12.5,
                  }}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {formatHour(h)}
                    </option>
                  ))}
                </select>
                <span style={{ color: "#5B6396", fontSize: 12.5 }}>à</span>
                <select
                  value={trafficEndHour}
                  onChange={(e) => setTrafficEndHour(Number(e.target.value))}
                  style={{
                    flex: 1,
                    padding: "6px 6px",
                    borderRadius: 6,
                    border: "1px solid #3A4578",
                    background: "#0B0F24",
                    color: "#F3F5FF",
                    fontSize: 12.5,
                  }}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {formatHour(h)}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background:
                      liveTraffic.status === "ready" ? "#2FD480" : liveTraffic.status === "error" ? "#D9635A" : "#5B6396",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 11.5, color: "#8A92C2" }}>
                  {liveTraffic.status === "loading" && "Récupération des vraies données…"}
                  {liveTraffic.status === "ready" && "Données en direct (serveur Cadence)"}
                  {liveTraffic.status === "error" && "Serveur injoignable pour le moment"}
                </span>
              </div>

              {liveTraffic.status === "loading" && (
                <p style={{ fontSize: 13, color: "#8A92C2" }}>Chargement des horaires réels…</p>
              )}

              {liveTraffic.status === "error" && (
                <div
                  style={{
                    background: "#141A38",
                    border: "1px solid #2B3564",
                    borderRadius: 12,
                    padding: "14px",
                    fontSize: 13,
                    color: "#8A92C2",
                  }}
                >
                  Impossible de récupérer les horaires pour {city.label} pour le moment. Réessayez dans quelques instants.
                </div>
              )}

              {liveTraffic.status === "ready" && (
                <>
                  <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: "#8A92C2", margin: "0 0 8px" }}>
                    Trains ({visibleTrains.length})
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
                    {visibleTrains.length === 0 && (
                      <p style={{ fontSize: 13, color: "#8A92C2" }}>Aucun train sur cette plage horaire.</p>
                    )}
                    {visibleTrains.map((t, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          background: "#141A38",
                          border: "1px solid #2B3564",
                          borderRadius: 12,
                          padding: "9px 12px",
                        }}
                      >
                        <div
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 9,
                            background: "#2FD480",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <TrainFront size={15} color="#0B0F24" strokeWidth={2.3} />
                        </div>
                        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, width: 44, flexShrink: 0 }}>
                          {t.time}
                        </span>
                        <span style={{ fontSize: 13, color: "#C7CDF0" }}>{t.label}</span>
                      </div>
                    ))}
                  </div>

                  <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: "#8A92C2", margin: "0 0 8px" }}>
                    Vols {liveTraffic.flightsAvailable ? `(${visibleFlights.length})` : ""}
                  </h3>
                  {!liveTraffic.flightsAvailable ? (
                    <p style={{ fontSize: 13, color: "#8A92C2" }}>
                      Pas de grand aéroport desservant directement {city.label}.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {visibleFlights.length === 0 && (
                        <p style={{ fontSize: 13, color: "#8A92C2" }}>Aucun vol sur cette plage horaire.</p>
                      )}
                      {visibleFlights.map((f, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            background: "#141A38",
                            border: "1px solid #2B3564",
                            borderRadius: 12,
                            padding: "9px 12px",
                          }}
                        >
                          <div
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: 9,
                              background: "#4C8DFF",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <Plane size={15} color="#0B0F24" strokeWidth={2.3} />
                          </div>
                          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, width: 44, flexShrink: 0 }}>
                            {f.time}
                          </span>
                          <span style={{ fontSize: 13, color: "#C7CDF0" }}>{f.label}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, marginTop: 16, padding: "10px 12px", background: "#141A38", borderRadius: 10, border: "1px solid #2B3564" }}>
                    <Info size={15} color="#5B6396" style={{ flexShrink: 0, marginTop: 1 }} />
                    <p style={{ margin: 0, fontSize: 11.5, color: "#5B6396", lineHeight: 1.5 }}>
                      Prochains passages réels à partir de maintenant, récupérés depuis SNCF{liveTraffic.flightsAvailable ? " et AviationStack" : ""}. La plage horaire filtre parmi ce qui reste à venir aujourd'hui.
                    </p>
                  </div>
                </>
              )}
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
                      liveEvents.status === "ready" ? "#2FD480" : liveEvents.status === "error" ? "#D9635A" : "#5B6396",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 11.5, color: "#8A92C2" }}>
                  {liveEvents.status === "loading" && "Récupération des vrais événements…"}
                  {liveEvents.status === "ready" && "Données en direct"}
                  {liveEvents.status === "error" && "Serveur injoignable — exemples affichés"}
                </span>
              </div>

              {liveEvents.status === "ready" && liveEvents.events.length === 0 && (
                <div
                  style={{
                    background: "#141A38",
                    border: "1px solid #2B3564",
                    borderRadius: 12,
                    padding: "14px",
                    marginBottom: 10,
                    fontSize: 13,
                    color: "#8A92C2",
                  }}
                >
                  Aucun événement à venir n'est encore publié pour {city.label} sur notre source actuelle. Ce n'est pas un problème technique — les organisateurs ajoutent leurs événements au fil du temps, revenez vérifier plus tard.
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(liveEvents.status === "ready" ? liveEvents.events : city.events || []).map((ev, i) => {
                  const catColor = eventCategoryColor(ev.category || ev.impact);
                  return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 12,
                      background: "#141A38",
                      border: "1px solid #2B3564",
                      borderRadius: 14,
                      padding: "13px 14px",
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 11,
                        background: catColor,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <CalendarDays size={16} color="#0B0F24" strokeWidth={2.3} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{ev.name}</div>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          flexShrink: 0,
                          color: catColor,
                          background: `${catColor}22`,
                        }}
                      >
                        {ev.category || ev.impact || "Événement"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "#8A92C2", marginTop: 6 }}>
                      {ev.date} {ev.time ? `· ${ev.time}` : ""}
                    </div>
                    <div style={{ fontSize: 12.5, color: "#8A92C2", marginTop: 2 }}>
                      {ev.venue || ev.zone}
                    </div>
                    </div>
                  </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16, padding: "10px 12px", background: "#141A38", borderRadius: 10, border: "1px solid #2B3564" }}>
                <Info size={15} color="#5B6396" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: 11.5, color: "#5B6396", lineHeight: 1.5 }}>
                  {liveEvents.status === "ready"
                    ? "Concerts, sport, théâtre et festivals à venir, récupérés via Ticketmaster."
                    : "Exemples affichés en secours (serveur relais indisponible pour le moment)."}
                </p>
              </div>
            </>
          )}

          {tab === "planning" && (
            <>
              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: "8px 0 4px" }}>
                Mon planning optimal — {city.label}
              </h2>
              <p style={{ fontSize: 12, color: "#8A92C2", margin: "0 0 14px" }}>
                Activez vos jours travaillés et réglez vos horaires pour chacun — l'appli vous dit où vous positionner.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {DAYS_OF_WEEK.map((d) => {
                  const daySchedule = planningSchedule[d.key];
                  const segments = daySchedule.enabled
                    ? buildDaySegments(city.zones, d.dayType, daySchedule.start, daySchedule.end)
                    : [];

                  return (
                    <div
                      key={d.key}
                      style={{
                        background: "#141A38",
                        border: "1px solid " + (daySchedule.enabled ? "#2B3564" : "#141A38"),
                        borderRadius: 14,
                        padding: "12px 14px",
                        opacity: daySchedule.enabled ? 1 : 0.6,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: daySchedule.enabled ? 10 : 0 }}>
                        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 13.5 }}>
                          {d.full}
                        </span>
                        <button
                          onClick={() =>
                            setPlanningSchedule((prev) => ({
                              ...prev,
                              [d.key]: { ...prev[d.key], enabled: !prev[d.key].enabled },
                            }))
                          }
                          style={{
                            width: 40,
                            height: 22,
                            borderRadius: 999,
                            border: "none",
                            background: daySchedule.enabled ? "#4C8DFF" : "#3A4578",
                            position: "relative",
                            cursor: "pointer",
                            flexShrink: 0,
                          }}
                          aria-label={daySchedule.enabled ? "Désactiver ce jour" : "Activer ce jour"}
                        >
                          <span
                            style={{
                              position: "absolute",
                              top: 3,
                              left: daySchedule.enabled ? 21 : 3,
                              width: 16,
                              height: 16,
                              borderRadius: "50%",
                              background: "#0B0F24",
                              transition: "left .15s ease",
                            }}
                          />
                        </button>
                      </div>

                      {daySchedule.enabled && (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                            <select
                              value={daySchedule.start}
                              onChange={(e) =>
                                setPlanningSchedule((prev) => ({
                                  ...prev,
                                  [d.key]: { ...prev[d.key], start: Number(e.target.value) },
                                }))
                              }
                              style={{
                                flex: 1,
                                padding: "7px 6px",
                                borderRadius: 8,
                                border: "1px solid #3A4578",
                                background: "#0B0F24",
                                color: "#F3F5FF",
                                fontSize: 12.5,
                              }}
                            >
                              {Array.from({ length: 24 }, (_, h) => (
                                <option key={h} value={h}>
                                  {formatHour(h)}
                                </option>
                              ))}
                            </select>
                            <span style={{ color: "#5B6396", fontSize: 12.5 }}>à</span>
                            <select
                              value={daySchedule.end}
                              onChange={(e) =>
                                setPlanningSchedule((prev) => ({
                                  ...prev,
                                  [d.key]: { ...prev[d.key], end: Number(e.target.value) },
                                }))
                              }
                              style={{
                                flex: 1,
                                padding: "7px 6px",
                                borderRadius: 8,
                                border: "1px solid #3A4578",
                                background: "#0B0F24",
                                color: "#F3F5FF",
                                fontSize: 12.5,
                              }}
                            >
                              {Array.from({ length: 24 }, (_, h) => (
                                <option key={h} value={h}>
                                  {formatHour(h)}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {segments.map((s, i) => {
                              const Icon = ICONS[s.type];
                              return (
                                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <span
                                    style={{
                                      fontFamily: "'Space Grotesk', sans-serif",
                                      fontSize: 12,
                                      color: "#8A92C2",
                                      width: 78,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {formatHour(s.startHour)}–{formatHour((s.endHour + 1) % 24)}
                                  </span>
                                  <div
                                    style={{
                                      width: 26,
                                      height: 26,
                                      borderRadius: 8,
                                      background: TYPE_COLORS[s.type],
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      flexShrink: 0,
                                    }}
                                  >
                                    <Icon size={13} color="#0B0F24" strokeWidth={2.3} />
                                  </div>
                                  <span style={{ fontSize: 13, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {s.name}
                                  </span>
                                  <span
                                    style={{
                                      fontFamily: "'Space Grotesk', sans-serif",
                                      fontWeight: 700,
                                      fontSize: 12,
                                      color: demandColor(s.avgScore),
                                      background: `${demandColor(s.avgScore)}22`,
                                      borderRadius: 999,
                                      padding: "3px 8px",
                                      flexShrink: 0,
                                    }}
                                  >
                                    {s.avgScore}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16, padding: "10px 12px", background: "#141A38", borderRadius: 10, border: "1px solid #2B3564" }}>
                <Info size={15} color="#5B6396" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: 11.5, color: "#5B6396", lineHeight: 1.5 }}>
                  Calculé à partir des tendances horaires habituelles de {city.label}.
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
                <p style={{ fontSize: 13, color: "#8A92C2" }}>
                  Aucune zone en forte demande à cette heure pour {city.label}.
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                {hotZones.map((z) => {
                  const Icon = ICONS[z.type];
                  return (
                    <div
                      key={z.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        background: "#141A38",
                        border: "1px solid #2B3564",
                        borderRadius: 14,
                        padding: "11px 14px",
                      }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 10,
                          background: TYPE_COLORS[z.type],
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Icon size={15} color="#0B0F24" strokeWidth={2.3} />
                      </div>
                      <div style={{ fontSize: 13.5, flex: 1 }}>
                        Forte demande estimée à <strong>{z.name}</strong>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: demandColor(z.score),
                          background: `${demandColor(z.score)}22`,
                          borderRadius: 999,
                          padding: "3px 9px",
                          flexShrink: 0,
                        }}
                      >
                        {z.score}
                      </span>
                    </div>
                  );
                })}
              </div>

              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: "0 0 10px" }}>
                À venir
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(liveEvents.status === "ready" ? liveEvents.events : city.events || []).slice(0, 5).map((ev, i) => {
                  const catColor = eventCategoryColor(ev.category || ev.impact);
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        background: "#141A38",
                        border: "1px solid #2B3564",
                        borderRadius: 14,
                        padding: "11px 14px",
                      }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 10,
                          background: catColor,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <CalendarDays size={15} color="#0B0F24" strokeWidth={2.3} />
                      </div>
                      <div style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>
                        {ev.name} — {ev.date} ({ev.venue || ev.zone})
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Navigation par cartes colorées — en bas, plus ergonomique au pouce */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 6,
            padding: "10px 10px calc(10px + env(safe-area-inset-bottom, 0px))",
            borderTop: "1px solid #2B3564",
            background: "#0B0F24",
          }}
        >
          {[
            { key: "demande", label: "Demande", Icon: MapPin, colors: ["#4C8DFF", "#6F5CFF"] },
            { key: "arrivees", label: "Trafic", Icon: TrainFront, colors: ["#2FD480", "#19A66A"] },
            { key: "evenements", label: "Events", Icon: CalendarDays, colors: ["#FF6FA5", "#FF3D7A"] },
            { key: "planning", label: "Planning", Icon: CalendarClock, colors: ["#FF9F43", "#FF7A3D"] },
            { key: "alertes", label: "Alertes", Icon: Bell, colors: ["#5B6396", "#3A4578"], badge: hotZones.length },
          ].map(({ key, label, Icon, colors, badge }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 5,
                  padding: "9px 2px",
                  borderRadius: 14,
                  border: active ? "2px solid #F3F5FF" : "2px solid transparent",
                  background: `linear-gradient(150deg, ${colors[0]}, ${colors[1]})`,
                  cursor: "pointer",
                  boxShadow: active ? `0 8px 20px -5px ${colors[0]}AA` : `0 4px 12px -6px ${colors[0]}66`,
                  opacity: active ? 1 : 0.88,
                }}
              >
                <Icon size={17} color="#F3F5FF" />
                <span style={{ fontSize: 9.5, fontWeight: 600, color: "#F3F5FF" }}>{label}</span>
                {badge > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -2,
                      background: "#FF5C4A",
                      color: "#F3F5FF",
                      borderRadius: 999,
                      fontSize: 9,
                      fontWeight: 700,
                      minWidth: 15,
                      height: 15,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 3px",
                      border: "2px solid #0B0F24",
                    }}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Panneau de détail — s'affiche au clic sur une zone (carte ou liste) */}
        {selectedZone && (
          <div
            onClick={() => setSelectedZone(null)}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(11,12,13,0.72)",
              display: "flex",
              alignItems: "flex-end",
              zIndex: 20,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxHeight: "78%",
                background: "#141A38",
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                border: "1px solid #2B3564",
                padding: "16px 18px calc(16px + env(safe-area-inset-bottom, 0px))",
                overflowY: "auto",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {(() => {
                    const Icon = ICONS[selectedZone.type];
                    return (
                      <div
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 9,
                          background: TYPE_COLORS[selectedZone.type],
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Icon size={16} color="#0B0F24" strokeWidth={2.3} />
                      </div>
                    );
                  })()}
                  <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 15 }}>
                    {selectedZone.name}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedZone(null)}
                  style={{ background: "none", border: "none", color: "#5B6396", fontSize: 20, cursor: "pointer", padding: 4 }}
                  aria-label="Fermer"
                >
                  ×
                </button>
              </div>
              <p style={{ fontSize: 12, color: "#8A92C2", margin: "0 0 14px" }}>
                Autour de {formatHour(hour)}, {dayLabel} — score {selectedZone.score}/100
              </p>

              {zoneDetail.status === "loading" && (
                <p style={{ fontSize: 13, color: "#8A92C2" }}>Récupération des infos…</p>
              )}
              {zoneDetail.status === "error" && (
                <p style={{ fontSize: 13, color: "#8A92C2" }}>Impossible de récupérer les infos pour le moment.</p>
              )}

              {zoneDetail.status === "ready" && selectedZone.type === "airport" && (
                <>
                  <h4 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12.5, fontWeight: 600, color: "#8A92C2", margin: "0 0 8px" }}>
                    Vols autour de cette heure
                  </h4>
                  {zoneDetail.flights.length === 0 ? (
                    <p style={{ fontSize: 13, color: "#8A92C2" }}>Aucun vol proche de cette heure.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {zoneDetail.flights.map((f, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "#0B0F24", border: "1px solid #2B3564", borderRadius: 10, padding: "9px 12px" }}>
                          <Plane size={14} color="#4C8DFF" style={{ flexShrink: 0 }} />
                          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, width: 44, flexShrink: 0 }}>{f.time}</span>
                          <span style={{ fontSize: 13, color: "#C7CDF0" }}>{f.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {zoneDetail.status === "ready" && selectedZone.type === "station" && (
                <>
                  <h4 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12.5, fontWeight: 600, color: "#8A92C2", margin: "0 0 8px" }}>
                    Trains autour de cette heure
                  </h4>
                  {zoneDetail.trains.length === 0 ? (
                    <p style={{ fontSize: 13, color: "#8A92C2" }}>Aucun train proche de cette heure.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {zoneDetail.trains.map((t, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "#0B0F24", border: "1px solid #2B3564", borderRadius: 10, padding: "9px 12px" }}>
                          <TrainFront size={14} color="#2FD480" style={{ flexShrink: 0 }} />
                          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, width: 44, flexShrink: 0 }}>{t.time}</span>
                          <span style={{ fontSize: 13, color: "#C7CDF0" }}>{t.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {zoneDetail.status === "ready" && !["airport", "station"].includes(selectedZone.type) && (
                <>
                  <h4 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12.5, fontWeight: 600, color: "#8A92C2", margin: "0 0 8px" }}>
                    Événements du jour à proximité
                  </h4>
                  {zoneDetail.events.length === 0 ? (
                    <p style={{ fontSize: 13, color: "#8A92C2" }}>Aucun événement recensé pour l'instant.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {zoneDetail.events.slice(0, 6).map((ev, i) => (
                        <div key={i} style={{ background: "#0B0F24", border: "1px solid #2B3564", borderRadius: 10, padding: "9px 12px" }}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{ev.name}</div>
                          <div style={{ fontSize: 11.5, color: "#8A92C2", marginTop: 2 }}>
                            {ev.date} {ev.time ? `· ${ev.time}` : ""} — {ev.venue}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
