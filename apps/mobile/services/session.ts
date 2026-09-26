import { createContext, useContext } from "react";

export const AuthSessionContext = createContext<{ authenticated: boolean; email: string | null }>({
  authenticated: false,
  email: null
});

export const AppAccessContext = createContext(false);
export const useAuthSession = () => useContext(AuthSessionContext);
export const useAppAccess = () => useContext(AppAccessContext);
