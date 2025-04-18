// src/app/api/upload/route.ts

import { NextRequest, NextResponse } from 'next/server';

// IMPORTANT: Read keys from server-side environment variables
const pinataKey = process.env.PINATA_KEY;
const pinataSecret = process.env.PINATA_SECRET;

export async function POST(request: NextRequest) {
    // Check if Pinata keys are configured on the server
    if (!pinataKey || !pinataSecret) {
        console.error("Server Error: Pinata API Key or Secret not configured.");
        return NextResponse.json({ error: "Image upload configuration error on server." }, { status: 500 });
    }

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: "No file provided in request." }, { status: 400 });
        }

        // Optional: Add server-side validation (size, type) if needed
        if (file.size > 5 * 1024 * 1024) { // 5MB limit example
            return NextResponse.json({ error: "File size exceeds limit (5MB)." }, { status: 400 });
        }
        // Add more type checks if necessary

        console.log(`Received file: ${file.name}, Size: ${file.size}`);

        // Create new FormData to send to Pinata
        const pinataFormData = new FormData();
        pinataFormData.append('file', file, file.name);
        // Optional: Add Pinata metadata if needed
        // const metadata = JSON.stringify({ name: `TokenLogo_${Date.now()}` });
        // pinataFormData.append('pinataMetadata', metadata);

        // Call Pinata API using fetch
        const pinataUrl = "https://api.pinata.cloud/pinning/pinFileToIPFS";
        const response = await fetch(pinataUrl, {
            method: "POST",
            headers: {
                // Use server-side keys - DO NOT expose secret to client
                'pinata_api_key': pinataKey,
                'pinata_secret_api_key': pinataSecret,
            },
            body: pinataFormData,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Failed to parse Pinata error response' }));
            console.error("Pinata API Error:", errorData);
            throw new Error(errorData?.error || `Pinata upload failed: ${response.statusText}`);
        }

        const result = await response.json();
        const ipfsHash = result.IpfsHash;

        if (!ipfsHash) {
            console.error("Pinata Response missing IpfsHash:", result);
            throw new Error("IPFS hash not found in Pinata response.");
        }

        // Construct gateway URL
        const url = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
        console.log(`Successfully uploaded to Pinata. IPFS URL: ${url}`);

        // Return the IPFS URL to the frontend
        return NextResponse.json({ ipfsUrl: url }, { status: 200 });

    } catch (error: any) {
        console.error("Error in /api/upload:", error);
        return NextResponse.json({ error: error.message || "Failed to upload image." }, { status: 500 });
    }
}

// Optional: Add GET handler or other methods if needed, otherwise they default to 405 Method Not Allowed
// export async function GET(request: NextRequest) {
//   return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
// }
