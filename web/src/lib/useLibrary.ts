import { useEffect, useState } from "react";
import { getLibraryState, loadLibrary, subscribeLibrary, type LibraryState } from "./libraryStore";

export function useLibrary(): LibraryState {
  const [state, setState] = useState<LibraryState>(getLibraryState());
  useEffect(() => {
    loadLibrary();
    return subscribeLibrary(setState);
  }, []);
  return state;
}
