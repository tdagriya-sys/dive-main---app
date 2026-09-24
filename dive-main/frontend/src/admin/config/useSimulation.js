import { useState, useRef } from "react";
import { configApiFor } from "./configApi";

// Scoring/Context Model screens only — see simulationService.ts's own
// comment on why Suggestion has no simulate endpoint. Runs the admin's
// current candidate payload against a bounded sample of real users on the
// backend and returns the aggregate before/after impact, without publishing
// anything.
export function useSimulation(base) {
  const api = useRef(configApiFor(base)).current;
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function runSimulation(payload, sampleSize) {
    setRunning(true);
    setError("");
    try {
      const data = await api.simulate(payload, sampleSize);
      setResult(data);
      return data;
    } catch {
      setError("Couldn't run the simulation. Please try again.");
      return undefined;
    } finally {
      setRunning(false);
    }
  }

  function clearResult() {
    setResult(null);
    setError("");
  }

  return { result, running, error, runSimulation, clearResult };
}
