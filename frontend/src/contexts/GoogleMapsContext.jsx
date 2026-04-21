import React, { createContext, useContext } from "react";
import { useJsApiLoader } from "@react-google-maps/api";

const GoogleMapsCtx = createContext({ isLoaded: false, loadError: null });

// Static libraries array to prevent reload warnings from useJsApiLoader
const LIBRARIES = [];

export function GoogleMapsProvider({ children }) {
    const { isLoaded, loadError } = useJsApiLoader({
        id: "rrdc-google-maps",
        googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_KEY || "",
        libraries: LIBRARIES,
    });
    return (
        <GoogleMapsCtx.Provider value={{ isLoaded, loadError }}>
            {children}
        </GoogleMapsCtx.Provider>
    );
}

export const useGoogleMaps = () => useContext(GoogleMapsCtx);
