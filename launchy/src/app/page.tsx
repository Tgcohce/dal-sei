// pages/index.tsx OR app/page.tsx (depending on your Next.js setup)
'use client'; // Required for Next.js App Router components using hooks

import React, { useState, useEffect } from 'react';
import { SigningCosmWasmClient, CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { GasPrice, calculateFee } from '@cosmjs/stargate';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"; // Assuming shadcn/ui setup
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast"; // Assuming shadcn/ui setup
import { Loader2 } from "lucide-react"; // For loading spinner

// --- Configuration ---
// !! IMPORTANT !! Replace with the actual Code ID of a deployed CW20 contract on Sei Atlantic-2 Testnet
const CW20_CODE_ID = 1234; // Placeholder - Needs a real Code ID!
const SEI_TESTNET_CHAIN_ID = 'atlantic-2';
const SEI_TESTNET_RPC = 'https://rpc.atlantic-2.seinetwork.io/'; // Verify this endpoint or use a more reliable one
const SEI_TESTNET_REST = 'https://rest.atlantic-2.seinetwork.io/'; // Needed for GasPrice? Check CosmJS docs
const SEI_GAS_PRICE_STRING = '0.1usei'; // Example gas price string
const INSTANTIATE_GAS = '500000'; // Estimated gas for CW20 instantiation - adjust as needed

// Define the expected structure for Keplr and Leap wallet objects in the window
interface WalletWindow extends Window {
  keplr?: any; // Replace 'any' with more specific types if available
  leap?: any;  // Replace 'any' with more specific types if available
}
declare var window: WalletWindow;

export default function LaunchpadPage() {
  // --- State Variables ---
  const [signingClient, setSigningClient] = useState<SigningCosmWasmClient | null>(null);
  const [userAddress, setUserAddress] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isLaunching, setIsLaunching] = useState<boolean>(false);

  // Form State
  const [tokenName, setTokenName] = useState<string>('');
  const [tokenSymbol, setTokenSymbol] = useState<string>('');
  const [tokenDecimals, setTokenDecimals] = useState<string>('6'); // Store as string for input control
  const [tokenSupply, setTokenSupply] = useState<string>('');

  // Feedback
  const { toast } = useToast();

  // --- Effects ---
  // Optional: Try to auto-connect or check wallet status on load
  // useEffect(() => {
  //     // Logic to check if already connected (e.g., check localStorage or attempt connection silently)
  // }, []);

  // --- Wallet Connection ---
  const handleConnectWallet = async () => {
    setIsConnecting(true);
    toast({ title: "Connecting Wallet...", description: "Please approve the connection in your wallet extension." });

    // Prefer Leap then Keplr
    const wallet = window.leap || window.keplr;
    if (!wallet) {
      toast({ variant: "destructive", title: "Wallet Not Found", description: "Please install Keplr or Leap wallet extension." });
      setIsConnecting(false);
      return;
    }

    try {
      // Enable the wallet for the specific chain
      await wallet.enable(SEI_TESTNET_CHAIN_ID);

      // Get the offline signer
      const offlineSigner = await wallet.getOfflineSigner(SEI_TESTNET_CHAIN_ID);

      // Get user accounts
      const accounts = await offlineSigner.getAccounts();
      if (accounts.length === 0) {
        throw new Error("No accounts found in wallet.");
      }
      const address = accounts[0].address;
      setUserAddress(address);

      // Create the signing client
      const client = await SigningCosmWasmClient.connectWithSigner(
          SEI_TESTNET_RPC,
          offlineSigner,
          {
            gasPrice: GasPrice.fromString(SEI_GAS_PRICE_STRING), // Use configured gas price
          }
      );
      setSigningClient(client);

      toast({ title: "Wallet Connected", description: `Address: ${address.substring(0, 10)}...${address.substring(address.length - 5)}` });

    } catch (error: any) {
      console.error("Wallet connection failed:", error);
      toast({ variant: "destructive", title: "Connection Failed", description: error.message || "Could not connect to wallet." });
      setUserAddress('');
      setSigningClient(null);
    } finally {
      setIsConnecting(false);
    }
  };

  // --- Token Launch ---
  const handleLaunchToken = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!signingClient || !userAddress) {
      toast({ variant: "destructive", title: "Wallet Not Connected", description: "Please connect your wallet first." });
      return;
    }

    // Basic Validation
    const decimalsNum = parseInt(tokenDecimals, 10);
    const supplyNum = parseInt(tokenSupply, 10); // Use BigInt below for actual calculation

    if (!tokenName || !tokenSymbol) {
      toast({ variant: "destructive", title: "Missing Information", description: "Please enter Token Name and Symbol." });
      return;
    }
    if (isNaN(decimalsNum) || decimalsNum < 0 || decimalsNum > 18) {
      toast({ variant: "destructive", title: "Invalid Decimals", description: "Decimals must be between 0 and 18." });
      return;
    }
    if (isNaN(supplyNum) || supplyNum <= 0) {
      toast({ variant: "destructive", title: "Invalid Supply", description: "Total Supply must be a positive number." });
      return;
    }
    if (!CW20_CODE_ID || CW20_CODE_ID === 1234) {
      toast({ variant: "destructive", title: "Configuration Error", description: "CW20 Code ID is not set correctly. Please update the placeholder." });
      return;
    }


    setIsLaunching(true);
    toast({ title: "Launching Token...", description: "Preparing and sending transaction..." });

    try {
      // Calculate initial supply based on decimals
      const initialSupply = (BigInt(tokenSupply) * (10n ** BigInt(decimalsNum))).toString();

      // Construct the Instantiate Message for CW20 contract
      const instantiateMsg = {
        name: tokenName,
        symbol: tokenSymbol,
        decimals: decimalsNum,
        initial_balances: [{
          address: userAddress, // Mint initial supply to the creator's address
          amount: initialSupply,
        }],
        mint: { // Allow minter to create more tokens later
          minter: userAddress, // Set creator as the initial minter
          // cap: "..." // Optional: Set a maximum total supply cap
        },
        // marketing: {} // Optional: Add marketing info
      };

      console.log("Instantiate Message:", JSON.stringify(instantiateMsg, null, 2));

      // Define instantiation fee
      // Note: calculateFee requires gas limit as number or string
      const fee = calculateFee(Number(INSTANTIATE_GAS), GasPrice.fromString(SEI_GAS_PRICE_STRING));
      console.log("Calculated Fee:", fee);

      // Send the instantiate transaction
      const result = await signingClient.instantiate(
          userAddress,
          CW20_CODE_ID, // The crucial Code ID!
          instantiateMsg,
          tokenName, // Label for the contract (human-readable identifier)
          fee,
          { memo: "Created via No-Code Launchpad", admin: userAddress } // Optional: admin can migrate contract
      );

      console.log("Instantiation Result:", result);
      const contractAddress = result.contractAddress;

      toast({
        title: "Token Launched Successfully!",
        description: (
            <div>
              Contract Address: <code className="font-mono break-all">{contractAddress}</code>
              <br />
              Tx Hash: <code className="font-mono break-all">{result.transactionHash}</code>
              {/* Optional: Add link to block explorer */}
              {/* <a href={`https://sei-testnet-explorer.com/tx/${result.transactionHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View on Explorer</a> */}
            </div>
        ),
        duration: 9000, // Keep toast longer
      });

      // Reset form after successful launch
      setTokenName('');
      setTokenSymbol('');
      setTokenDecimals('6');
      setTokenSupply('');

    } catch (error: any) {
      console.error("Token launch failed:", error);
      toast({
        variant: "destructive",
        title: "Launch Failed",
        description: error.message || "Transaction failed. Check console and wallet for details.",
        duration: 9000,
      });
    } finally {
      setIsLaunching(false);
    }
  };

  // --- Render ---
  return (
      <div className="flex items-center justify-center min-h-screen p-4 bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50">
        <Card className="w-full max-w-lg shadow-xl">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl font-bold">Sei Token Launchpad</CardTitle>
            <CardDescription>Easily launch your CW20 token on Sei Testnet (Atlantic-2)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Wallet Section */}
            <div className="text-center space-y-2">
              {!userAddress ? (
                  <Button
                      onClick={handleConnectWallet}
                      disabled={isConnecting}
                      className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
                  >
                    {isConnecting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Connecting...
                        </>
                    ) : (
                        'Connect Wallet (Keplr/Leap)'
                    )}
                  </Button>
              ) : (
                  <div className="p-3 border rounded-md bg-green-50 border-green-200 text-green-800">
                    <p className="text-sm font-medium">Wallet Connected!</p>
                    <p className="text-xs font-mono break-all">{userAddress}</p>
                  </div>
              )}
            </div>

            {/* Token Form */}
            <form onSubmit={handleLaunchToken} className="space-y-5">
              {/* Token Name */}
              <div>
                <Label htmlFor="tokenName">Token Name</Label>
                <Input
                    id="tokenName"
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    placeholder="e.g., My Awesome Token"
                    required
                    disabled={isLaunching || !userAddress}
                />
              </div>

              {/* Token Symbol */}
              <div>
                <Label htmlFor="tokenSymbol">Token Symbol</Label>
                <Input
                    id="tokenSymbol"
                    value={tokenSymbol}
                    onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                    placeholder="e.g., MAT"
                    maxLength={8} // Increased max length slightly
                    required
                    disabled={isLaunching || !userAddress}
                />
                <p className="text-xs text-gray-500 mt-1">Usually 3-8 uppercase letters.</p>
              </div>

              {/* Token Decimals */}
              <div>
                <Label htmlFor="tokenDecimals">Decimals</Label>
                <Input
                    id="tokenDecimals"
                    type="number"
                    value={tokenDecimals}
                    onChange={(e) => setTokenDecimals(e.target.value)}
                    placeholder="e.g., 6"
                    min="0"
                    max="18"
                    required
                    disabled={isLaunching || !userAddress}
                />
                <p className="text-xs text-gray-500 mt-1">Standard is 6 or 18. Determines smallest unit divisibility.</p>
              </div>

              {/* Token Supply */}
              <div>
                <Label htmlFor="tokenSupply">Total Supply</Label>
                <Input
                    id="tokenSupply"
                    type="number"
                    value={tokenSupply}
                    onChange={(e) => setTokenSupply(e.target.value)}
                    placeholder="e.g., 1000000"
                    min="1"
                    required
                    disabled={isLaunching || !userAddress}
                />
                <p className="text-xs text-gray-500 mt-1">The total number of tokens to mint initially.</p>
              </div>

              {/* Launch Button */}
              <Button
                  type="submit"
                  disabled={isLaunching || !userAddress || !signingClient}
                  className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white"
              >
                {isLaunching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Launching...
                    </>
                ) : (
                    'Launch Token'
                )}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="text-center text-xs text-gray-500">
            <p>Ensure you have USEI tokens on Atlantic-2 Testnet for gas fees. Get some from a <a href="https://atlantic-2.app.sei.io/faucet" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Sei Faucet</a>.</p>
          </CardFooter>
        </Card>
      </div>
  );
}

// --- Required for shadcn/ui Toast ---
// Make sure you have a <Toaster /> component in your layout.tsx or equivalent root layout file.
// Example layout.tsx:
// import { Toaster } from "@/components/ui/toaster"
// export default function RootLayout({ children }: { children: React.ReactNode }) {
//   return (
//     <html lang="en">
//       <body>
//         {children}
//         <Toaster />
//       </body>
//     </html>
//   )
// }
