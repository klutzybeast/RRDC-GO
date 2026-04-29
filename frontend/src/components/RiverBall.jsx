import React from "react";
import CampBall from "./CampBall";

/**
 * Backward-compatible wrapper: the old "Rolling River Ball" is now the
 * default Pokeball variant from CampBall. Existing imports of RiverBall
 * keep working everywhere; consumers wanting a specific ball should use
 * <CampBall ballId="rayball" /> directly.
 */
export const RiverBall = React.forwardRef(function RiverBall(props, ref) {
    return <CampBall ref={ref} ballId={props.ballId || "pokeball"} {...props} />;
});

export default RiverBall;
