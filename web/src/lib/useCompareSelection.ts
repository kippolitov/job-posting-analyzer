import { useEffect, useState } from "react";
import { getCompareSelection, subscribeCompareSelection } from "./compareStore";

export function useCompareSelection(): string[] {
  const [selected, setSelected] = useState<string[]>(getCompareSelection());
  useEffect(() => subscribeCompareSelection(setSelected), []);
  return selected;
}
