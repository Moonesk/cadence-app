import { useState, useMemo, useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
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
const COOL = [62, 142, 138]; // #3E8E8A
const WARM = [232, 147, 74]; // #E8934A
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

function DemandMap({ zones, center }) {
  return (
    <div
      style={{
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid #262B2F",
        marginBottom: 16,
        height: 260,
      }}
    >
      <MapContainer
        center={center}
        zoom={12}
        style={{ width: "100%", height: "100%", background: "#1D2124" }}
        scrollWheelZoom={false}
        key={`${center[0]}-${center[1]}`}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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
  const [planningDays, setPlanningDays] = useState(["lundi", "mardi", "mercredi", "jeudi", "vendredi"]);
  const [planningStart, setPlanningStart] = useState(8);
  const [planningEnd, setPlanningEnd] = useState(20);
  const [demandView, setDemandView] = useState("map"); // "map" | "list"
  const [trafficMode, setTrafficMode] = useState("arrivals"); // "arrivals" | "departures"
  const [liveTraffic, setLiveTraffic] = useState({ status: "idle", trains: [], flights: [], flightsAvailable: true });

  useEffect(() => {
    if (tab !== "arrivees") return;
    let cancelled = false;
    setLiveTraffic({ status: "loading", trains: [], flights: [], flightsAvailable: true });
    const station = STATION_NAMES[cityKey];
    Promise.allSettled([
      fetch(
        `${SERVER_BASE_URL}/api/trains?station=${encodeURIComponent(station)}&kind=${trafficMode}`
      ).then((r) => r.json()),
      fetch(`${SERVER_BASE_URL}/api/flights?city=${cityKey}&kind=${trafficMode}`).then((r) => r.json()),
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

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 10px" }}>
                <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: 0 }}>
                  Demande par zone — {city.label}, {dayLabel}
                </h2>
                <div style={{ display: "flex", gap: 4, background: "#1D2124", borderRadius: 8, padding: 3, border: "1px solid #262B2F" }}>
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
                      background: demandView === "map" ? "rgba(232,147,74,0.15)" : "transparent",
                      color: demandView === "map" ? "#E8934A" : "#6D757B",
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
                      background: demandView === "list" ? "rgba(232,147,74,0.15)" : "transparent",
                      color: demandView === "list" ? "#E8934A" : "#6D757B",
                      cursor: "pointer",
                    }}
                  >
                    <List size={14} />
                  </button>
                </div>
              </div>

              {demandView === "map" && (
                <DemandMap zones={zonesScored} center={[city.lat, city.lon]} />
              )}

              {demandView === "list" && (
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
              )}

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
                  {liveTraffic.status === "error" && "Serveur injoignable pour le moment"}
                </span>
              </div>

              {liveTraffic.status === "loading" && (
                <p style={{ fontSize: 13, color: "#9BA3A8" }}>Chargement des horaires réels…</p>
              )}

              {liveTraffic.status === "error" && (
                <div
                  style={{
                    background: "#1D2124",
                    border: "1px solid #262B2F",
                    borderRadius: 12,
                    padding: "14px",
                    fontSize: 13,
                    color: "#9BA3A8",
                  }}
                >
                  Impossible de récupérer les horaires pour {city.label} pour le moment. Réessayez dans quelques instants.
                </div>
              )}

              {liveTraffic.status === "ready" && (
                <>
                  <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: "#9BA3A8", margin: "0 0 8px" }}>
                    Trains
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
                    {liveTraffic.trains.length === 0 && (
                      <p style={{ fontSize: 13, color: "#9BA3A8" }}>Aucun train trouvé pour l'instant.</p>
                    )}
                    {liveTraffic.trains.map((t, i) => (
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
                  {!liveTraffic.flightsAvailable ? (
                    <p style={{ fontSize: 13, color: "#9BA3A8" }}>
                      Pas de grand aéroport desservant directement {city.label}.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {liveTraffic.flights.length === 0 && (
                        <p style={{ fontSize: 13, color: "#9BA3A8" }}>Aucun vol trouvé pour l'instant.</p>
                      )}
                      {liveTraffic.flights.map((f, i) => (
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
                  )}

                  <div style={{ display: "flex", gap: 8, marginTop: 16, padding: "10px 12px", background: "#1D2124", borderRadius: 10, border: "1px solid #262B2F" }}>
                    <Info size={15} color="#6D757B" style={{ flexShrink: 0, marginTop: 1 }} />
                    <p style={{ margin: 0, fontSize: 11.5, color: "#6D757B", lineHeight: 1.5 }}>
                      Prochains passages réels, récupérés depuis SNCF{liveTraffic.flightsAvailable ? " et AviationStack" : ""} via votre serveur relais.
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
                      liveEvents.status === "ready" ? "#3E8E8A" : liveEvents.status === "error" ? "#D9635A" : "#6D757B",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 11.5, color: "#9BA3A8" }}>
                  {liveEvents.status === "loading" && "Récupération des vrais événements…"}
                  {liveEvents.status === "ready" && "Données en direct"}
                  {liveEvents.status === "error" && "Serveur injoignable — exemples affichés"}
                </span>
              </div>

              {liveEvents.status === "ready" && liveEvents.events.length === 0 && (
                <div
                  style={{
                    background: "#1D2124",
                    border: "1px solid #262B2F",
                    borderRadius: 12,
                    padding: "14px",
                    marginBottom: 10,
                    fontSize: 13,
                    color: "#9BA3A8",
                  }}
                >
                  Aucun événement à venir n'est encore publié pour {city.label} sur notre source actuelle. Ce n'est pas un problème technique — les organisateurs ajoutent leurs événements au fil du temps, revenez vérifier plus tard.
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(liveEvents.status === "ready" ? liveEvents.events : city.events || []).map((ev, i) => (
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

          {tab === "planning" && (
            <>
              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: "8px 0 4px" }}>
                Mon planning optimal — {city.label}
              </h2>
              <p style={{ fontSize: 12, color: "#9BA3A8", margin: "0 0 14px" }}>
                Indiquez vos jours et horaires de travail, l'appli vous dit où vous positionner à chaque créneau.
              </p>

              <div
                style={{
                  background: "#1D2124",
                  border: "1px solid #262B2F",
                  borderRadius: 14,
                  padding: "14px 16px",
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 12.5, color: "#9BA3A8", marginBottom: 8 }}>Jours travaillés</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                  {DAYS_OF_WEEK.map((d) => {
                    const active = planningDays.includes(d.key);
                    return (
                      <button
                        key={d.key}
                        onClick={() =>
                          setPlanningDays((prev) =>
                            active ? prev.filter((k) => k !== d.key) : [...prev, d.key]
                          )
                        }
                        style={{
                          width: 40,
                          height: 34,
                          borderRadius: 8,
                          border: "1px solid " + (active ? "#E8934A" : "#33393E"),
                          background: active ? "rgba(232,147,74,0.15)" : "transparent",
                          color: active ? "#E8934A" : "#9BA3A8",
                          fontSize: 12.5,
                          fontWeight: 500,
                          cursor: "pointer",
                        }}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>

                <div style={{ fontSize: 12.5, color: "#9BA3A8", marginBottom: 8 }}>Horaires de travail</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <select
                    value={planningStart}
                    onChange={(e) => setPlanningStart(Number(e.target.value))}
                    style={{
                      flex: 1,
                      padding: "9px 8px",
                      borderRadius: 8,
                      border: "1px solid #33393E",
                      background: "#14171A",
                      color: "#EDEFEF",
                      fontSize: 13,
                    }}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {formatHour(h)}
                      </option>
                    ))}
                  </select>
                  <span style={{ color: "#6D757B", fontSize: 13 }}>à</span>
                  <select
                    value={planningEnd}
                    onChange={(e) => setPlanningEnd(Number(e.target.value))}
                    style={{
                      flex: 1,
                      padding: "9px 8px",
                      borderRadius: 8,
                      border: "1px solid #33393E",
                      background: "#14171A",
                      color: "#EDEFEF",
                      fontSize: 13,
                    }}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {formatHour(h)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {planningDays.length === 0 && (
                <p style={{ fontSize: 13, color: "#9BA3A8" }}>Sélectionnez au moins un jour travaillé.</p>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {DAYS_OF_WEEK.filter((d) => planningDays.includes(d.key)).map((d) => {
                  const segments = buildDaySegments(city.zones, d.dayType, planningStart, planningEnd);
                  return (
                    <div
                      key={d.key}
                      style={{
                        background: "#1D2124",
                        border: "1px solid #262B2F",
                        borderRadius: 14,
                        padding: "12px 14px",
                      }}
                    >
                      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 13.5, marginBottom: 8 }}>
                        {d.full}
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
                                  color: "#9BA3A8",
                                  width: 78,
                                  flexShrink: 0,
                                }}
                              >
                                {formatHour(s.startHour)}–{formatHour((s.endHour + 1) % 24)}
                              </span>
                              <Icon size={14} color={demandColor(s.avgScore)} style={{ flexShrink: 0 }} />
                              <span style={{ fontSize: 13, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {s.name}
                              </span>
                              <span
                                style={{
                                  fontFamily: "'Space Grotesk', sans-serif",
                                  fontWeight: 600,
                                  fontSize: 13,
                                  color: demandColor(s.avgScore),
                                  flexShrink: 0,
                                }}
                              >
                                {s.avgScore}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16, padding: "10px 12px", background: "#1D2124", borderRadius: 10, border: "1px solid #262B2F" }}>
                <Info size={15} color="#6D757B" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: 11.5, color: "#6D757B", lineHeight: 1.5 }}>
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
                {(liveEvents.status === "ready" ? liveEvents.events : city.events || []).slice(0, 5).map((ev, i) => (
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
            { key: "planning", label: "Planning", Icon: CalendarClock },
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
import { useState, useMemo, useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
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
const COOL = [62, 142, 138]; // #3E8E8A
const WARM = [232, 147, 74]; // #E8934A
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

function DemandMap({ zones, center }) {
  return (
    <div
      style={{
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid #262B2F",
        marginBottom: 16,
        height: 260,
      }}
    >
      <MapContainer
        center={center}
        zoom={12}
        style={{ width: "100%", height: "100%", background: "#1D2124" }}
        scrollWheelZoom={false}
        key={`${center[0]}-${center[1]}`}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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
  const [planningDays, setPlanningDays] = useState(["lundi", "mardi", "mercredi", "jeudi", "vendredi"]);
  const [planningStart, setPlanningStart] = useState(8);
  const [planningEnd, setPlanningEnd] = useState(20);
  const [demandView, setDemandView] = useState("map"); // "map" | "list"
  const [trafficMode, setTrafficMode] = useState("arrivals"); // "arrivals" | "departures"
  const [liveTraffic, setLiveTraffic] = useState({ status: "idle", trains: [], flights: [], flightsAvailable: true });

  useEffect(() => {
    if (tab !== "arrivees") return;
    let cancelled = false;
    setLiveTraffic({ status: "loading", trains: [], flights: [], flightsAvailable: true });
    const station = STATION_NAMES[cityKey];
    Promise.allSettled([
      fetch(
        `${SERVER_BASE_URL}/api/trains?station=${encodeURIComponent(station)}&kind=${trafficMode}`
      ).then((r) => r.json()),
      fetch(`${SERVER_BASE_URL}/api/flights?city=${cityKey}&kind=${trafficMode}`).then((r) => r.json()),
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

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 10px" }}>
                <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: 0 }}>
                  Demande par zone — {city.label}, {dayLabel}
                </h2>
                <div style={{ display: "flex", gap: 4, background: "#1D2124", borderRadius: 8, padding: 3, border: "1px solid #262B2F" }}>
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
                      background: demandView === "map" ? "rgba(232,147,74,0.15)" : "transparent",
                      color: demandView === "map" ? "#E8934A" : "#6D757B",
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
                      background: demandView === "list" ? "rgba(232,147,74,0.15)" : "transparent",
                      color: demandView === "list" ? "#E8934A" : "#6D757B",
                      cursor: "pointer",
                    }}
                  >
                    <List size={14} />
                  </button>
                </div>
              </div>

              {demandView === "map" && (
                <DemandMap zones={zonesScored} center={[city.lat, city.lon]} />
              )}

              {demandView === "list" && (
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
              )}

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
                  {liveTraffic.status === "error" && "Serveur injoignable pour le moment"}
                </span>
              </div>

              {liveTraffic.status === "loading" && (
                <p style={{ fontSize: 13, color: "#9BA3A8" }}>Chargement des horaires réels…</p>
              )}

              {liveTraffic.status === "error" && (
                <div
                  style={{
                    background: "#1D2124",
                    border: "1px solid #262B2F",
                    borderRadius: 12,
                    padding: "14px",
                    fontSize: 13,
                    color: "#9BA3A8",
                  }}
                >
                  Impossible de récupérer les horaires pour {city.label} pour le moment. Réessayez dans quelques instants.
                </div>
              )}

              {liveTraffic.status === "ready" && (
                <>
                  <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: "#9BA3A8", margin: "0 0 8px" }}>
                    Trains
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
                    {liveTraffic.trains.length === 0 && (
                      <p style={{ fontSize: 13, color: "#9BA3A8" }}>Aucun train trouvé pour l'instant.</p>
                    )}
                    {liveTraffic.trains.map((t, i) => (
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
                  {!liveTraffic.flightsAvailable ? (
                    <p style={{ fontSize: 13, color: "#9BA3A8" }}>
                      Pas de grand aéroport desservant directement {city.label}.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {liveTraffic.flights.length === 0 && (
                        <p style={{ fontSize: 13, color: "#9BA3A8" }}>Aucun vol trouvé pour l'instant.</p>
                      )}
                      {liveTraffic.flights.map((f, i) => (
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
                  )}

                  <div style={{ display: "flex", gap: 8, marginTop: 16, padding: "10px 12px", background: "#1D2124", borderRadius: 10, border: "1px solid #262B2F" }}>
                    <Info size={15} color="#6D757B" style={{ flexShrink: 0, marginTop: 1 }} />
                    <p style={{ margin: 0, fontSize: 11.5, color: "#6D757B", lineHeight: 1.5 }}>
                      Prochains passages réels, récupérés depuis SNCF{liveTraffic.flightsAvailable ? " et AviationStack" : ""} via votre serveur relais.
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
                      liveEvents.status === "ready" ? "#3E8E8A" : liveEvents.status === "error" ? "#D9635A" : "#6D757B",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 11.5, color: "#9BA3A8" }}>
                  {liveEvents.status === "loading" && "Récupération des vrais événements…"}
                  {liveEvents.status === "ready" && "Données en direct"}
                  {liveEvents.status === "error" && "Serveur injoignable — exemples affichés"}
                </span>
              </div>

              {liveEvents.status === "ready" && liveEvents.events.length === 0 && (
                <div
                  style={{
                    background: "#1D2124",
                    border: "1px solid #262B2F",
                    borderRadius: 12,
                    padding: "14px",
                    marginBottom: 10,
                    fontSize: 13,
                    color: "#9BA3A8",
                  }}
                >
                  Aucun événement à venir n'est encore publié pour {city.label} sur notre source actuelle. Ce n'est pas un problème technique — les organisateurs ajoutent leurs événements au fil du temps, revenez vérifier plus tard.
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(liveEvents.status === "ready" ? liveEvents.events : city.events || []).map((ev, i) => (
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

          {tab === "planning" && (
            <>
              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, margin: "8px 0 4px" }}>
                Mon planning optimal — {city.label}
              </h2>
              <p style={{ fontSize: 12, color: "#9BA3A8", margin: "0 0 14px" }}>
                Indiquez vos jours et horaires de travail, l'appli vous dit où vous positionner à chaque créneau.
              </p>

              <div
                style={{
                  background: "#1D2124",
                  border: "1px solid #262B2F",
                  borderRadius: 14,
                  padding: "14px 16px",
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 12.5, color: "#9BA3A8", marginBottom: 8 }}>Jours travaillés</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                  {DAYS_OF_WEEK.map((d) => {
                    const active = planningDays.includes(d.key);
                    return (
                      <button
                        key={d.key}
                        onClick={() =>
                          setPlanningDays((prev) =>
                            active ? prev.filter((k) => k !== d.key) : [...prev, d.key]
                          )
                        }
                        style={{
                          width: 40,
                          height: 34,
                          borderRadius: 8,
                          border: "1px solid " + (active ? "#E8934A" : "#33393E"),
                          background: active ? "rgba(232,147,74,0.15)" : "transparent",
                          color: active ? "#E8934A" : "#9BA3A8",
                          fontSize: 12.5,
                          fontWeight: 500,
                          cursor: "pointer",
                        }}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>

                <div style={{ fontSize: 12.5, color: "#9BA3A8", marginBottom: 8 }}>Horaires de travail</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <select
                    value={planningStart}
                    onChange={(e) => setPlanningStart(Number(e.target.value))}
                    style={{
                      flex: 1,
                      padding: "9px 8px",
                      borderRadius: 8,
                      border: "1px solid #33393E",
                      background: "#14171A",
                      color: "#EDEFEF",
                      fontSize: 13,
                    }}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {formatHour(h)}
                      </option>
                    ))}
                  </select>
                  <span style={{ color: "#6D757B", fontSize: 13 }}>à</span>
                  <select
                    value={planningEnd}
                    onChange={(e) => setPlanningEnd(Number(e.target.value))}
                    style={{
                      flex: 1,
                      padding: "9px 8px",
                      borderRadius: 8,
                      border: "1px solid #33393E",
                      background: "#14171A",
                      color: "#EDEFEF",
                      fontSize: 13,
                    }}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {formatHour(h)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {planningDays.length === 0 && (
                <p style={{ fontSize: 13, color: "#9BA3A8" }}>Sélectionnez au moins un jour travaillé.</p>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {DAYS_OF_WEEK.filter((d) => planningDays.includes(d.key)).map((d) => {
                  const segments = buildDaySegments(city.zones, d.dayType, planningStart, planningEnd);
                  return (
                    <div
                      key={d.key}
                      style={{
                        background: "#1D2124",
                        border: "1px solid #262B2F",
                        borderRadius: 14,
                        padding: "12px 14px",
                      }}
                    >
                      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 13.5, marginBottom: 8 }}>
                        {d.full}
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
                                  color: "#9BA3A8",
                                  width: 78,
                                  flexShrink: 0,
                                }}
                              >
                                {formatHour(s.startHour)}–{formatHour((s.endHour + 1) % 24)}
                              </span>
                              <Icon size={14} color={demandColor(s.avgScore)} style={{ flexShrink: 0 }} />
                              <span style={{ fontSize: 13, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {s.name}
                              </span>
                              <span
                                style={{
                                  fontFamily: "'Space Grotesk', sans-serif",
                                  fontWeight: 600,
                                  fontSize: 13,
                                  color: demandColor(s.avgScore),
                                  flexShrink: 0,
                                }}
                              >
                                {s.avgScore}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16, padding: "10px 12px", background: "#1D2124", borderRadius: 10, border: "1px solid #262B2F" }}>
                <Info size={15} color="#6D757B" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: 11.5, color: "#6D757B", lineHeight: 1.5 }}>
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
                {(liveEvents.status === "ready" ? liveEvents.events : city.events || []).slice(0, 5).map((ev, i) => (
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
            { key: "planning", label: "Planning", Icon: CalendarClock },
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
