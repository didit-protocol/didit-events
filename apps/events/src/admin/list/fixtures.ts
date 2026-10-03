/** A-02 fixtures: the six events of design/01 Admin (`evRaw`), in design order. */
import type { AdminEventRow } from "./types";

const row = (
  id: string,
  month: string,
  day: string,
  name: string,
  when: string,
  where: string,
  status: AdminEventRow["status"],
  invited: number,
  verified: number,
  checkedIn: number,
): AdminEventRow => ({ id, month, day, name, when, where, status, invited, verified, checkedIn });

export const ADMIN_EVENTS: AdminEventRow[] = [
  row("bcn-opening", "OCT", "23", "Barcelona Office Opening", "Fri 23 Oct · 19:00–23:00", "Didit HQ, Carrer de Pallars 99", "live", 124, 98, 42),
  row("madrid-fintech-breakfast", "NOV", "12", "Madrid Fintech Breakfast", "Thu 12 Nov · 08:30–10:30", "Espacio Castellana, Madrid", "open", 60, 31, 0),
  row("lisbon-roundtable", "DEC", "04", "Customer Roundtable Lisbon", "Fri 4 Dec · 18:00–21:00", "LX Factory, Lisbon", "open", 40, 12, 0),
  row("holiday-party-2026", "DEC", "18", "Didit Holiday Party 2026", "Fri 18 Dec · 20:00–01:00", "TBC, Barcelona", "draft", 0, 0, 0),
  row("amsterdam-partner-evening", "JUN", "03", "Amsterdam Partner Evening", "Wed 3 Jun · 19:00–22:00", "Pllek, Amsterdam", "ended", 85, 79, 71),
  row("sf-launch-night", "APR", "14", "San Francisco Launch Night", "Tue 14 Apr · 18:30–22:00", "Pier 27, San Francisco", "ended", 150, 132, 118),
];
