// pages/index.tsx OR app/page.tsx (depending on your Next.js setup)
'use client'; // Required for Next.js App Router components using hooks

import React, { useState, useEffect, useMemo } from 'react';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { GasPrice, calculateFee } from '@cosmjs/stargate';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"; // Assuming shadcn/ui setup
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast"; // Assuming shadcn/ui setup
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"; // For network selection
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"; // For warnings
import { Loader2, AlertTriangle, Network } from "lucide-react"; // Icons

// --- Types ---
type NetworkType = 'testnet' | 'mainnet';

interface NetworkConfig {
  chainId: string;
  rpcEndpoint: string;
  restEndpoint: string;
  gasPrice: string;
  cw20CodeId: number; // Storing as number, ensure it's valid
  explorerBaseUrl: string; // For linking transactions
  faucetUrl?: string; // Only for testnet
}

// Define the expected structure for Keplr and Leap wallet objects in the window
interface WalletWindow extends Window {
  keplr?: any;
  leap?: any;
}
declare var window: WalletWindow;

// --- Environment Variable Validation ---
// Basic check to ensure env vars are loaded. Production apps might need more robust validation.
const testnetConfig: NetworkConfig | null = process.env.NEXT_PUBLIC_TESTNET_CHAIN_ID ? {
  chainId: process.env.NEXT_PUBLIC_TESTNET_CHAIN_ID,
  rpcEndpoint: process.env.NEXT_PUBLIC_TESTNET_RPC_ENDPOINT!,
  restEndpoint: process.env.NEXT_PUBLIC_TESTNET_REST_ENDPOINT!,
  gasPrice: process.env.NEXT_PUBLIC_TESTNET_GAS_PRICE!,
  cw20CodeId: parseInt(process.env.NEXT_PUBLIC_TESTNET_CW20_CODE_ID || '0', 10), // Default to 0 if missing
  explorerBaseUrl: 'https://testnet.sei.explorers.guru', // Example testnet explorer
  faucetUrl: 'https://atlantic-2.app.sei.io/faucet',
} : null;

const mainnetConfig: NetworkConfig | null = process.env.NEXT_PUBLIC_MAINNET_CHAIN_ID ? {
  chainId: process.env.NEXT_PUBLIC_MAINNET_CHAIN_ID,
  rpcEndpoint: process.env.NEXT_PUBLIC_MAINNET_RPC_ENDPOINT!,
  restEndpoint: process.env.NEXT_PUBLIC_MAINNET_REST_ENDPOINT!,
  gasPrice: process.env.NEXT_PUBLIC_MAINNET_GAS_PRICE!,
  cw20CodeId: parseInt(process.env.NEXT_PUBLIC_MAINNET_CW20_CODE_ID || '0', 10), // Default to 0 if missing
  explorerBaseUrl: 'https://sei.explorers.guru', // Example mainnet explorer
} : null;

const instantiateGas = process.env.NEXT_PUBLIC_INSTANTIATE_GAS || '500000';


export default function LaunchpadPage() {
  // --- State Variables ---
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkType>('testnet');
  const [signingClient, setSigningClient] = useState<SigningCosmWasmClient | null>(null);
  const [userAddress, setUserAddress] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isLaunching, setIsLaunching] = useState<boolean>(false);
  const [currentChainId, setCurrentChainId] = useState<string | null>(null); // Track wallet's actual connected chain

  // Form State
  const [tokenName, setTokenName] = useState<string>('');
  const [tokenSymbol, setTokenSymbol] = useState<string>('');
  const [tokenDecimals, setTokenDecimals] = useState<string>('6');
  const [tokenSupply, setTokenSupply] = useState<string>('');

  // Feedback
  const { toast } = useToast();

  // --- Derived State & Memos ---
  const config = useMemo((): NetworkConfig | null => {
    if (selectedNetwork === 'mainnet') return mainnetConfig;
    return testnetConfig; // Default to testnet if mainnet not configured or selected
  }, [selectedNetwork]);

  const isEnvConfigured = useMemo(() => {
    // Check if essential config exists for the selected network
    if (!config || !config.chainId || !config.rpcEndpoint || !config.gasPrice || !config.cw20CodeId) {
      return false;
    }
    // Check if placeholder Code IDs are still being used
    if (config.cw20CodeId === 1234 || config.cw20CodeId === 5678 || config.cw20CodeId === 0) {
      console.warn(`Placeholder or zero CW20 Code ID detected for ${selectedNetwork}: ${config.cw20CodeId}. Replace in .env.local`);
      // Allow proceeding but maybe show a stronger warning in UI later
    }
    return true;
  }, [config, selectedNetwork]);

  const isWalletConnectedToCorrectNetwork = useMemo(() => {
    if (!userAddress || !currentChainId || !config) return false;
    return currentChainId === config.chainId;
  }, [userAddress, currentChainId, config]);


  // --- Effects ---
  // Listen for wallet account changes or network changes
  useEffect(() => {
    const handleAccountChange = () => {
      console.log("Wallet account or network changed. Reconnecting...");
      // Reset connection state and prompt user to reconnect
      setUserAddress('');
      setSigningClient(null);
      setCurrentChainId(null);
      toast({ title: "Wallet Changed", description: "Wallet account or network changed. Please reconnect.", variant: "default" });
    };

    const wallet = window.leap || window.keplr;
    if (wallet && wallet.eventListener) { // Check if event listener mechanism exists
      wallet.eventListener('keplr_keystorechange', handleAccountChange); // Example event name, check wallet docs
    }

    // Cleanup listener on component unmount
    return () => {
      if (wallet && wallet.off) { // Check if 'off' method exists
        wallet.off('keplr_keystorechange', handleAccountChange);
      }
    };
  }, []);


  // --- Wallet Connection ---
  const handleConnectWallet = async () => {
    if (!config) {
      toast({ variant: "destructive", title: "Configuration Error", description: `Network configuration for ${selectedNetwork} is missing.` });
      return;
    }
    if (!isEnvConfigured) {
      toast({ variant: "destructive", title: "Configuration Incomplete", description: `Check .env.local for ${selectedNetwork}. Code ID might be missing or a placeholder.` });
      // Optionally prevent connection if config is critically incomplete
    }

    setIsConnecting(true);
    toast({ title: "Connecting Wallet...", description: `Please approve connection for ${config.chainId} in your wallet.` });

    const wallet = window.leap || window.keplr;
    if (!wallet) {
      toast({ variant: "destructive", title: "Wallet Not Found", description: "Please install Keplr or Leap wallet extension." });
      setIsConnecting(false);
      return;
    }

    try {
      // Suggest the chain to the wallet (optional, but good practice)
      // This might prompt the user to add the network if they haven't already
      try {
        await wallet.experimentalSuggestChain({
          chainId: config.chainId,
          rpc: config.rpcEndpoint,
          rest: config.restEndpoint,
          // Add other chain details like bech32 prefix, currency, etc.
          // Refer to Keplr/Leap documentation for the full structure
        });
      } catch (suggestError: any) {
        console.warn("Could not suggest chain (might be already added or unsupported):", suggestError.message);
      }


      // Enable the wallet for the specific chain
      await wallet.enable(config.chainId);

      // Get the offline signer
      const offlineSigner = await wallet.getOfflineSigner(config.chainId);

      // Get user accounts
      const accounts = await offlineSigner.getAccounts();
      if (accounts.length === 0) throw new Error("No accounts found in wallet.");
      const address = accounts[0].address;

      // Get the current chain ID the wallet is connected to (important!)
      const key = await wallet.getKey(config.chainId); // Or similar method to get wallet state
      // This part is highly dependent on the wallet's API.
      // We assume getKey or a similar function provides chain info,
      // otherwise we might need to query the client after connection.
      // For simplicity, we'll set it after client creation for now.


      // Create the signing client
      const client = await SigningCosmWasmClient.connectWithSigner(
          config.rpcEndpoint,
          offlineSigner,
          { gasPrice: GasPrice.fromString(config.gasPrice) }
      );

      // Verify the client is connected to the expected chain
      const connectedChainId = await client.getChainId();
      if (connectedChainId !== config.chainId) {
        throw new Error(`Wallet connected to wrong chain. Expected ${config.chainId}, got ${connectedChainId}. Please switch network in wallet.`);
      }

      setUserAddress(address);
      setSigningClient(client);
      setCurrentChainId(connectedChainId); // Set the actual connected chain ID

      toast({ title: "Wallet Connected", description: `Address: ${address.substring(0, 10)}...${address.substring(address.length - 5)} on ${connectedChainId}` });

    } catch (error: any) {
      console.error("Wallet connection failed:", error);
      toast({ variant: "destructive", title: "Connection Failed", description: error.message || "Could not connect to wallet." });
      setUserAddress('');
      setSigningClient(null);
      setCurrentChainId(null);
    } finally {
      setIsConnecting(false);
    }
  };

  // --- Token Launch ---
  const handleLaunchToken = async (event: React.FormEvent) => {
    event.preventDefault();

    // --- Pre-flight Checks ---
    if (!signingClient || !userAddress || !config) {
      toast({ variant: "destructive", title: "Prerequisites Not Met", description: "Please connect your wallet to the selected network first." });
      return;
    }
    if (!isWalletConnectedToCorrectNetwork) {
      toast({ variant: "destructive", title: "Network Mismatch", description: `Wallet is connected to ${currentChainId}, but ${config.chainId} is selected. Please switch network in wallet or app.` });
      return;
    }
    if (!isEnvConfigured || config.cw20CodeId <= 0 || config.cw20CodeId === 1234 || config.cw20CodeId === 5678) {
      toast({ variant: "destructive", title: "Configuration Issue", description: `Invalid or placeholder CW20 Code ID (${config.cw20CodeId}) for ${selectedNetwork}. Update .env.local.` });
      return; // Hard stop if Code ID is clearly wrong
    }

    // Basic Form Validation
    const decimalsNum = parseInt(tokenDecimals, 10);
    const supplyNum = parseInt(tokenSupply, 10); // Use BigInt below

    if (!tokenName || !tokenSymbol || isNaN(decimalsNum) || decimalsNum < 0 || decimalsNum > 18 || isNaN(supplyNum) || supplyNum <= 0) {
      toast({ variant: "destructive", title: "Invalid Form Data", description: "Please check all token details are filled correctly." });
      return;
    }

    setIsLaunching(true);
    toast({ title: "Launching Token...", description: `Submitting transaction on ${config.chainId}...` });

    try {
      // Calculate initial supply based on decimals
      const initialSupply = (BigInt(tokenSupply) * (10n ** BigInt(decimalsNum))).toString();

      // Construct the Instantiate Message
      const instantiateMsg = {
        name: tokenName,
        symbol: tokenSymbol,
        decimals: decimalsNum,
        initial_balances: [{ address: userAddress, amount: initialSupply }],
        mint: { minter: userAddress },
      };

      // Calculate Fee
      const fee = calculateFee(Number(instantiateGas), GasPrice.fromString(config.gasPrice));

      // Send the instantiate transaction
      const result = await signingClient.instantiate(
          userAddress,
          config.cw20CodeId, // Use network-specific Code ID
          instantiateMsg,
          tokenName, // Label
          fee,
          { memo: "Created via No-Code Launchpad", admin: userAddress }
      );

      console.log("Instantiation Result:", result);
      const contractAddress = result.contractAddress;
      const txHash = result.transactionHash;
      const explorerLink = `${config.explorerBaseUrl}/tx/${txHash}`;

      toast({
        title: "Token Launched Successfully!",
        description: (
            <div>
              <p>Network: {config.chainId}</p>
              <p>Contract: <code className="font-mono break-all">{contractAddress}</code></p>
              <a href={explorerLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline block mt-1">
                View Transaction on Explorer
              </a>
            </div>
        ),
        duration: 15000, // Keep toast longer
      });

      // Reset form
      setTokenName(''); setTokenSymbol(''); setTokenDecimals('6'); setTokenSupply('');

    } catch (error: any) {
      console.error("Token launch failed:", error);
      // Try to parse CosmJS errors for better messages
      let errorMessage = error.message || "Transaction failed. Check console and wallet.";
      if (error.log) { // CosmJS often includes logs on failure
        errorMessage = `Transaction failed: ${error.log}`;
      } else if (error.code) { // Standard error codes
        errorMessage = `Error code ${error.code}: ${errorMessage}`;
      }
      toast({
        variant: "destructive",
        title: "Launch Failed",
        description: errorMessage,
        duration: 10000,
      });
    } finally {
      setIsLaunching(false);
    }
  };

  // --- Render ---
  return (
      <div className="flex items-center justify-center min-h-screen p-4 bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50">
        <Card className="w-full max-w-xl shadow-xl"> {/* Increased max-width */}
          <CardHeader className="text-center">
            <CardTitle className="text-3xl font-bold">Sei Token Launchpad</CardTitle>
            <CardDescription>Launch your CW20 token on Sei Network</CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Network Selection */}
            <div className="space-y-2">
              <Label className="flex items-center"><Network className="mr-2 h-4 w-4"/>Select Network</Label>
              <RadioGroup
                  value={selectedNetwork}
                  onValueChange={(value: string) => {
                    // Disconnect wallet when network changes to avoid mismatches
                    setUserAddress('');
                    setSigningClient(null);
                    setCurrentChainId(null);
                    setSelectedNetwork(value as NetworkType);
                  }}
                  className="flex space-x-4"
                  disabled={isConnecting || isLaunching}
              >
                {testnetConfig && (
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="testnet" id="testnet" />
                      <Label htmlFor="testnet">Testnet (Atlantic-2)</Label>
                    </div>
                )}
                {mainnetConfig && (
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="mainnet" id="mainnet" />
                      <Label htmlFor="mainnet">Mainnet (Pacific-1)</Label>
                    </div>
                )}
              </RadioGroup>
              {!isEnvConfigured && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Configuration Warning</AlertTitle>
                    <AlertDescription>
                      Environment variables for {selectedNetwork} might be missing or incomplete (check `.env.local`). Ensure Code IDs are correct.
                    </AlertDescription>
                  </Alert>
              )}
            </div>

            {/* Mainnet Warning */}
            {selectedNetwork === 'mainnet' && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Mainnet Selected!</AlertTitle>
                  <AlertDescription>
                    You are about to interact with the Sei Mainnet. Transactions require real USEI tokens for gas fees and are irreversible. Ensure you understand the risks. Use an audited CW20 Code ID.
                  </AlertDescription>
                </Alert>
            )}

            {/* Wallet Section */}
            <div className="text-center space-y-2">
              <Button
                  onClick={handleConnectWallet}
                  disabled={isConnecting || !config || !!signingClient} // Disable if connecting, no config, or already connected
                  className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
              >
                {isConnecting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Connecting...</> :
                    signingClient ? 'Wallet Connected' : 'Connect Wallet (Keplr/Leap)'}
              </Button>
              {userAddress && (
                  <div className={`p-3 border rounded-md text-sm ${isWalletConnectedToCorrectNetwork ? 'bg-green-50 border-green-200 text-green-800' : 'bg-yellow-50 border-yellow-300 text-yellow-800'}`}>
                    <p className="font-medium">
                      {isWalletConnectedToCorrectNetwork ? `Connected to ${currentChainId}` : `Wallet on wrong network (${currentChainId})`}
                    </p>
                    <p className="text-xs font-mono break-all">{userAddress}</p>
                    {!isWalletConnectedToCorrectNetwork && config && (
                        <p className="text-xs font-bold mt-1">Please switch wallet to {config.chainId} or change selected network.</p>
                    )}
                  </div>
              )}
            </div>

            {/* Token Form */}
            <form onSubmit={handleLaunchToken} className="space-y-5 border-t pt-6">
              <h3 className="text-lg font-semibold text-center mb-4">Configure Your Token</h3>
              {/* Inputs remain largely the same, but disable based on connection/network match */}
              <div>
                <Label htmlFor="tokenName">Token Name</Label>
                <Input id="tokenName" value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder="e.g., My Awesome Token" required disabled={isLaunching || !isWalletConnectedToCorrectNetwork} />
              </div>
              <div>
                <Label htmlFor="tokenSymbol">Token Symbol</Label>
                <Input id="tokenSymbol" value={tokenSymbol} onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())} placeholder="e.g., MAT" maxLength={8} required disabled={isLaunching || !isWalletConnectedToCorrectNetwork}/>
                <p className="text-xs text-gray-500 mt-1">Usually 3-8 uppercase letters.</p>
              </div>
              <div>
                <Label htmlFor="tokenDecimals">Decimals</Label>
                <Input id="tokenDecimals" type="number" value={tokenDecimals} onChange={(e) => setTokenDecimals(e.target.value)} placeholder="e.g., 6" min="0" max="18" required disabled={isLaunching || !isWalletConnectedToCorrectNetwork}/>
                <p className="text-xs text-gray-500 mt-1">Standard: 6 or 18.</p>
              </div>
              <div>
                <Label htmlFor="tokenSupply">Total Supply</Label>
                <Input id="tokenSupply" type="number" value={tokenSupply} onChange={(e) => setTokenSupply(e.target.value)} placeholder="e.g., 1000000" min="1" required disabled={isLaunching || !isWalletConnectedToCorrectNetwork}/>
                <p className="text-xs text-gray-500 mt-1">Total number to mint initially.</p>
              </div>

              {/* Launch Button */}
              <Button
                  type="submit"
                  disabled={isLaunching || !isWalletConnectedToCorrectNetwork || !signingClient}
                  className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white"
              >
                {isLaunching ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Launching...</> : 'Launch Token'}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="text-center text-xs text-gray-500 flex-col space-y-1">
            {config?.faucetUrl && selectedNetwork === 'testnet' && (
                <p>Need testnet funds? Visit the <a href={config.faucetUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Sei Faucet</a>.</p>
            )}
            <p>Ensure your wallet is funded for gas fees on the selected network.</p>
            <p className="font-semibold">Use audited Code IDs for Mainnet deployments.</p>
          </CardFooter>
        </Card>
      </div>
  );
}

// --- Required for shadcn/ui Toast ---
// Ensure <Toaster /> is in layout.tsx or equivalent root layout file.
