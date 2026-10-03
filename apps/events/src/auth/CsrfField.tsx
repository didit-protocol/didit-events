"use client";
import { createContext, useContext, type ReactNode } from "react";
const Csrf = createContext("");
export function CsrfProvider({ token, children }: { token: string; children: ReactNode }) { return <Csrf.Provider value={token}>{children}</Csrf.Provider>; }
export function CsrfField() { const token = useContext(Csrf); return <input type="hidden" name="csrf" value={token} />; }
export function useCsrf() { return useContext(Csrf); }
