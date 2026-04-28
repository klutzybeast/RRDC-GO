// Pokemon GO–inspired Google Maps style.
// Bright saturated greens for parks/land, vivid blue water, white roads,
// minimal labels — looks like the PoGO playfield.
const pokemonGoMapStyle = [
    // Geometry: warm cream base
    { elementType: "geometry", stylers: [{ color: "#a8e6a3" }] },
    { elementType: "labels", stylers: [{ visibility: "off" }] },

    // Show key labels for kids to navigate
    { featureType: "administrative.locality", elementType: "labels", stylers: [{ visibility: "on" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#1f4e3d" }] },
    { featureType: "administrative.locality", elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }, { weight: 3 }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#3b3b3b" }] },
    { featureType: "road", elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }, { weight: 2 }] },

    // Hide POIs / business clutter
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },

    // Parks: deep saturated green
    { featureType: "poi.park", elementType: "geometry", stylers: [{ visibility: "on" }, { color: "#7dd87a" }] },
    { featureType: "poi.school", elementType: "geometry", stylers: [{ visibility: "on" }, { color: "#cdebcd" }] },
    { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#a8e6a3" }] },
    { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: "#b8edb3" }] },

    // Roads: clean white with subtle outline
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#7dd87a" }, { weight: 1.5 }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#fff7c2" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#e6c862" }] },

    // Water: vibrant blue
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#3eb6ff" }] },
    { featureType: "water", elementType: "geometry.stroke", stylers: [{ color: "#2095e0" }] },
];

export default pokemonGoMapStyle;
