"use client";

import { useEffect, useRef, useState } from "react";
import { Combobox, Icon, Select, TextField, type ComboboxOption } from "@didit-events/ui";
import type { EventFormErrors, EventFormValues } from "./types";
import { CITY_MAX, COUNTRIES, STREET_MAX, VENUE_MAX, composeAddress, effectiveAddress } from "./validate";
import s from "./EventForm.module.css";

type LocationKeys = "venue" | "address" | "street" | "city" | "postalCode" | "country" | "placeId" | "lat" | "lng" | "mapsUrl";
export type LocationValues = Pick<EventFormValues, LocationKeys>;

interface Suggestion { placeId: string; main: string; secondary: string }
interface Place { placeId: string; name: string; formattedAddress: string; street: string; city: string; postalCode: string; country: string; lat: number; lng: number; mapsUrl: string }

/** Tests replace the network with a fake; production calls the staff-only proxy routes. */
export type PlacesFetch = (url: string) => Promise<Response>;

export interface LocationFieldProps {
  values: LocationValues;
  errors: EventFormErrors;
  /** Server side: GOOGLE_MAPS_API_KEY is configured. Without it the manual fields are the only mode. */
  placesEnabled: boolean;
  readOnly?: boolean;
  onChange: (patch: Partial<LocationValues>) => void;
  onBlur: (field: keyof EventFormErrors) => void;
  fetcher?: PlacesFetch;
  /** Debounce before a suggestion request (ms). */
  debounce?: number;
}

const EMPTY_PLACE = { placeId: "", lat: "", lng: "", mapsUrl: "" };
const newSession = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");

/**
 * A-03 Location. With Google Maps configured: one combobox (type ≥ 3 characters → Places suggestions, debounced
 * 250 ms, keyboard navigable), picking one fills the venue (place name) and the formatted address and shows a
 * read-only summary with "Edit manually". Without a key, or after "Edit manually", or when Places fails: plain
 * venue / street / city / postal code / country fields. Every value posts through hidden inputs.
 */
export function LocationField({ values, errors, placesEnabled, readOnly, onChange, onBlur, fetcher = (url) => fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } }), debounce = 250 }: LocationFieldProps) {
  const [mode, setMode] = useState<"search" | "place" | "manual">(() => (values.placeId ? "place" : !placesEnabled || values.venue || values.address ? "manual" : "search"));
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string>();
  const session = useRef(newSession());
  const seq = useRef(0);

  const fallBack = () => {
    setMode("manual");
    setSuggestions([]);
    setNotice("Google Maps search is unavailable right now. Enter the address manually.");
  };

  const onQuery = (text: string) => {
    setQuery(text);
    const short = text.trim().length < 3;
    if (short) setSuggestions([]);
    setLoading(!short);
  };

  // Debounced suggestions (latest request wins); fewer than 3 characters sends nothing.
  useEffect(() => {
    const q = query.trim();
    if (mode !== "search" || q.length < 3) return;
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetcher(`/api/admin/places/autocomplete?q=${encodeURIComponent(q)}&session=${session.current}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { suggestions?: Suggestion[] };
        if (id === seq.current) setSuggestions(body.suggestions ?? []);
      } catch {
        if (id === seq.current) fallBack();
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, debounce);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode]);

  const pick = async (o: ComboboxOption) => {
    setLoading(true);
    try {
      const res = await fetcher(`/api/admin/places/details?id=${encodeURIComponent(o.value)}&session=${session.current}`);
      if (!res.ok) throw new Error(String(res.status));
      const { place } = (await res.json()) as { place: Place };
      onChange({
        venue: place.name.slice(0, VENUE_MAX),
        address: place.formattedAddress,
        street: place.street,
        city: place.city,
        postalCode: place.postalCode,
        country: place.country,
        placeId: place.placeId,
        lat: String(place.lat),
        lng: String(place.lng),
        mapsUrl: place.mapsUrl,
      });
      setMode("place");
      setQuery("");
      setSuggestions([]);
      setNotice(undefined);
    } catch {
      fallBack();
    } finally {
      // A details call closes the billing session; the next search starts a new one.
      session.current = newSession();
      setLoading(false);
    }
  };

  const toManual = () => {
    // Keep what Google filled in, but it is no longer a pinned place.
    const country = (COUNTRIES as readonly string[]).includes(values.country) ? values.country : "";
    onChange({ ...EMPTY_PLACE, country, address: composeAddress({ ...values, country }) });
    setMode("manual");
    setNotice(undefined);
  };
  const toSearch = () => {
    onChange({ venue: "", address: "", street: "", city: "", postalCode: "", country: "", ...EMPTY_PLACE });
    setMode("search");
    setNotice(undefined);
  };

  const hidden = (["venue", "address", "street", "city", "postalCode", "country", "placeId", "lat", "lng", "mapsUrl"] as const).map((k) => (
    <input key={k} type="hidden" name={k} value={k === "address" ? effectiveAddress({ ...values } as EventFormValues) : values[k]} />
  ));
  const field = (k: "venue" | "street" | "city" | "postalCode") => ({
    value: values[k],
    error: errors[k],
    readOnly,
    onChange: (e: { target: { value: string } }) => onChange({ [k]: e.target.value }),
    onBlur: () => onBlur(k),
  });

  return (
    <div className={s.location}>
      {hidden}
      {mode === "search" ? (
        <div data-field="venue address street city postalCode country">
          <Combobox
            label="Location"
            placeholder="Search a venue or address"
            inputValue={query}
            onInputChange={onQuery}
            options={suggestions.map((x) => ({ value: x.placeId, label: x.main, description: x.secondary }))}
            onSelect={(o) => void pick(o)}
            listLabel="Suggested places"
            loading={loading && suggestions.length === 0}
            emptyText={query.trim().length >= 3 && !loading ? "No places found. Try another search or enter it manually." : null}
            leading={<Icon name="pin" size={16} />}
            error={errors.venue || errors.address ? "Pick a location or enter the address manually" : undefined}
            hint="Powered by Google Maps"
            readOnly={readOnly}
            onBlur={() => onBlur("venue")}
          />
          <button type="button" className={s.link} onClick={() => setMode("manual")}>
            Enter the address manually
          </button>
        </div>
      ) : mode === "place" ? (
        <div className={s.placeCard} aria-label="Selected location" role="group" data-field="address venue">
          <div className={s.placeHead}>
            <Icon name="pin" size={16} />
            <div className={s.placeText}>
              <span className={s.placeName}>{values.venue}</span>
              <span className={s.placeAddress}>{values.address}</span>
            </div>
            {values.mapsUrl ? (
              <a href={values.mapsUrl} target="_blank" rel="noopener noreferrer" className={s.link}>
                Open in Maps
              </a>
            ) : null}
          </div>
          <dl className={s.placeParts}>
            {(
              [
                ["Street", values.street],
                ["City", values.city],
                ["Postal code", values.postalCode],
                ["Country", values.country],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || "—"}</dd>
              </div>
            ))}
          </dl>
          {errors.address ? <span className={s.error}>{errors.address}</span> : null}
          <div className={s.placeActions}>
            <button type="button" className={s.link} onClick={toManual} disabled={readOnly}>
              Edit manually
            </button>
            <button type="button" className={s.link} onClick={toSearch} disabled={readOnly}>
              Change location
            </button>
          </div>
        </div>
      ) : (
        <>
          {notice ? (
            <p className={s.notice} role="status">
              {notice}
            </p>
          ) : null}
          <div className={s.row3}>
            <div data-field="venue">
              <TextField label="Venue" placeholder="Venue name" maxLength={VENUE_MAX + 20} hint={`${values.venue.trim().length}/${VENUE_MAX}`} {...field("venue")} />
            </div>
            <div data-field="street address">
              <TextField label="Street" placeholder="Carrer de Pallars 99" autoComplete="address-line1" maxLength={STREET_MAX + 20} {...field("street")} error={errors.street ?? errors.address} />
            </div>
            <div data-field="city">
              <TextField label="City" placeholder="Barcelona" autoComplete="address-level2" maxLength={CITY_MAX + 20} {...field("city")} />
            </div>
          </div>
          <div className={s.row3}>
            <div data-field="postalCode">
              <TextField label={<>Postal code<span className={s.opt}> · optional</span></>} placeholder="08018" autoComplete="postal-code" maxLength={12} {...field("postalCode")} />
            </div>
            <div data-field="country">
            <Select
              label={<>Country<span className={s.opt}> · optional</span></>}
              value={values.country}
              error={errors.country}
              onChange={(e) => onChange({ country: e.target.value })}
              onBlur={() => onBlur("country")}
              options={[{ value: "", label: "Choose a country" }, ...COUNTRIES.map((c) => ({ value: c, label: c }))]}
            />
            </div>
            {placesEnabled ? (
              <div className={s.searchLink}>
                <button type="button" className={s.link} onClick={toSearch} disabled={readOnly}>
                  Search Google Maps instead
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
