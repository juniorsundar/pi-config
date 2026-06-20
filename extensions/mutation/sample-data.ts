/**
 * Sample content for the diff-overlay prototype.
 *
 * Large files with changes spread far apart so diff produces multiple
 * separate hunks (default context is 3 lines, so we need >3 unchanged
 * lines between changes).
 */

export const FILE_A = `import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// === Section 1: Imports & Setup ===
const VERSION = "1.0.0";
const DEFAULT_NAME = "world";

function greet(name: string): string {
  return "Hello, " + name + "!";
}

function farewell(name: string): string {
  return "Goodbye, " + name + "!";
}

// === Section 2: Core Logic ===
function add(a: number, b: number): number {
  return a + b;
}

function subtract(a: number, b: number): number {
  return a - b;
}

function multiply(a: number, b: number): number {
  return a * b;
}

function divide(a: number, b: number): number {
  if (b === 0) throw new Error("Division by zero");
  return a / b;
}

function power(base: number, exp: number): number {
  return Math.pow(base, exp);
}

// === Section 3: Collection Helpers ===
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}

function last<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

function reverse<T>(arr: T[]): T[] {
  return arr.slice().reverse();
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// === Section 4: Async Utilities ===
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    delay(ms).then(() => { throw new Error("Timeout"); }),
  ]);
}

// === Section 5: String Utilities ===
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

const users = ["Alice", "Bob", "Charlie"];

for (const user of users) {
  console.log(greet(user));
}

export { greet, farewell, add, subtract, multiply, divide };
`;

export const FILE_B = `import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

// === Section 1: Imports & Setup ===
const VERSION = "2.0.0";
const DEFAULT_NAME = "world";
const AUTHOR = "Pi Team";

function greet(name: string, formal = false): string {
  if (formal) {
    return "Good day, " + name + ".";
  }
  return "Hello, " + name + "!";
}

function farewell(name: string): string {
  return "Farewell, " + name + "!";
}

// === Section 2: Core Logic ===
function add(a: number, b: number): number {
  return a + b;
}

function subtract(a: number, b: number): number {
  return a - b;
}

function multiply(a: number, b: number): number {
  return a * b;
}

function divide(a: number, b: number): number {
  if (b === 0) throw new Error("Division by zero");
  return a / b;
}

function modulo(a: number, b: number): number {
  return a % b;
}

function power(base: number, exp: number): number {
  return Math.pow(base, exp);
}

// === Section 3: Collection Helpers ===
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}

function last<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

function reverse<T>(arr: T[]): T[] {
  return arr.slice().reverse();
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function flatten<T>(arr: T[][]): T[] {
  return arr.flat();
}

// === Section 4: Async Utilities ===
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    delay(ms).then(() => { throw new Error("Timeout after " + ms + "ms"); }),
  ]);
}

function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  return fn().catch((err) => {
    if (attempts <= 1) throw err;
    return retry(fn, attempts - 1);
  });
}

// === Section 5: String Utilities ===
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function padLeft(s: string, width: number, char = " "): string {
  return s.length >= width ? s : char.repeat(width - s.length) + s;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

const users = ["Alice", "Bob", "Charlie", "Diana"];

for (const user of users) {
  console.log(greet(user));
  console.log(farewell(user));
}

export { greet, farewell, add, subtract, multiply, divide, modulo };
`;
