import React, { useRef, useMemo } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";

function PlaceholderSphere() {
    const ref = useRef();
    useFrame((state) => {
        const t = state.clock.getElapsedTime();
        if (ref.current) {
            ref.current.position.y = Math.sin(t * 1.4) * 0.18;
            ref.current.rotation.y = t * 0.6;
        }
    });
    return (
        <mesh ref={ref}>
            <icosahedronGeometry args={[0.8, 1]} />
            <meshStandardMaterial color="#0EA5E9" metalness={0.2} roughness={0.3} />
        </mesh>
    );
}

function TexturedPlane({ url, rarity }) {
    const group = useRef();
    const texture = useLoader(THREE.TextureLoader, url);
    useMemo(() => {
        if (texture) {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 8;
        }
    }, [texture]);
    useFrame((state) => {
        const t = state.clock.getElapsedTime();
        if (group.current) {
            group.current.position.y = Math.sin(t * 1.4) * 0.2;
            group.current.rotation.y = Math.sin(t * 0.6) * 0.25;
        }
    });

    // Determine plane aspect ratio from image
    const aspect = texture?.image ? texture.image.width / texture.image.height : 1;
    const h = 2.4;
    const w = h * aspect;

    const glowColor = {
        common: "#94A3B8",
        uncommon: "#22C55E",
        rare: "#3B82F6",
        legendary: "#FBBF24",
    }[rarity] || "#94A3B8";

    return (
        <group ref={group}>
            {/* Glow halo */}
            <mesh position={[0, 0, -0.05]}>
                <circleGeometry args={[Math.max(w, h) * 0.7, 48]} />
                <meshBasicMaterial color={glowColor} transparent opacity={0.35} />
            </mesh>
            <mesh>
                <planeGeometry args={[w, h]} />
                <meshBasicMaterial map={texture} transparent alphaTest={0.01} side={THREE.DoubleSide} />
            </mesh>
        </group>
    );
}

export default function PokemonModel({ imageUrl, rarity }) {
    return (
        <Canvas
            className="ar-canvas"
            camera={{ position: [0, 0, 4], fov: 45 }}
            gl={{ alpha: true, antialias: true }}
            dpr={[1, 2]}
        >
            <ambientLight intensity={0.8} />
            <directionalLight position={[2, 3, 5]} intensity={0.6} />
            {imageUrl ? (
                <React.Suspense fallback={<PlaceholderSphere />}>
                    <TexturedPlane url={imageUrl} rarity={rarity} />
                </React.Suspense>
            ) : (
                <PlaceholderSphere />
            )}
        </Canvas>
    );
}
