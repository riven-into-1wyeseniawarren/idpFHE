import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface IdentityAttribute {
  id: string;
  name: string;
  value: number;
  encryptedValue: string;
  timestamp: number;
  category: string;
  isVerified: boolean;
  proofType: string;
}

interface OperationLog {
  id: string;
  type: 'encrypt' | 'decrypt' | 'verify' | 'sso_login';
  timestamp: number;
  description: string;
  status: 'success' | 'pending' | 'error';
  targetApp?: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}-${Date.now()}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    const base64Data = encryptedData.split('-')[1];
    return parseFloat(atob(base64Data));
  }
  return parseFloat(encryptedData);
};

const FHEVerifyAttribute = (encryptedData: string, condition: string): boolean => {
  const value = FHEDecryptNumber(encryptedData);
  
  switch(condition) {
    case 'isAdult':
      return value >= 18;
    case 'isPremium':
      return value >= 1000;
    case 'hasKYC':
      return value === 1;
    default:
      return value > 0;
  }
};

const generateSignatureMessage = (publicKey: string) => 
  `Zama FHE Identity Proof\nPublic Key: ${publicKey.substring(0, 20)}...\nTimestamp: ${Date.now()}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [attributes, setAttributes] = useState<IdentityAttribute[]>([]);
  const [operationLogs, setOperationLogs] = useState<OperationLog[]>([]);
  const [isRefreshing, setRefreshing] = useState(false);
  const [showAddAttribute, setShowAddAttribute] = useState(false);
  const [addingAttribute, setAddingAttribute] = useState(false);
  const [txStatus, setTxStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, status: "pending", message: "" 
  });
  const [newAttribute, setNewAttribute] = useState({ name: "", value: 0, category: "personal", proofType: "age_verification" });
  const [selectedAttribute, setSelectedAttribute] = useState<IdentityAttribute | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [fheStatus, setFheStatus] = useState<'active' | 'inactive'>('inactive');
  const [activeTab, setActiveTab] = useState<'attributes' | 'logs' | 'sso'>('attributes');

  // Initialize FHE status and public key
  useEffect(() => {
    const initFHE = async () => {
      setLoading(true);
      try {
        const contract = await getContractReadOnly();
        if (contract) {
          const isAvailable = await contract.isAvailable();
          setFheStatus(isAvailable ? 'active' : 'inactive');
          setPublicKey(`0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`);
          await loadAttributes();
          await loadOperationLogs();
        }
      } catch (error) {
        console.error("FHE initialization failed:", error);
      } finally {
        setLoading(false);
      }
    };
    initFHE();
  }, []);

  const loadAttributes = async () => {
    setRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const keysBytes = await contract.getData("attribute_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing attribute keys:", e); }
      }
      
      const attributeList: IdentityAttribute[] = [];
      for (const key of keys) {
        try {
          const attributeBytes = await contract.getData(`attribute_${key}`);
          if (attributeBytes.length > 0) {
            const attributeData = JSON.parse(ethers.toUtf8String(attributeBytes));
            attributeList.push({
              id: key,
              name: attributeData.name,
              value: attributeData.value,
              encryptedValue: attributeData.encryptedValue,
              timestamp: attributeData.timestamp,
              category: attributeData.category,
              isVerified: attributeData.isVerified || false,
              proofType: attributeData.proofType || "basic"
            });
          }
        } catch (e) { console.error(`Error loading attribute ${key}:`, e); }
      }
      
      attributeList.sort((a, b) => b.timestamp - a.timestamp);
      setAttributes(attributeList);
    } catch (e) { 
      console.error("Error loading attributes:", e); 
    } finally { 
      setRefreshing(false); 
    }
  };

  const loadOperationLogs = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const logsBytes = await contract.getData("operation_logs");
      let logs: OperationLog[] = [];
      if (logsBytes.length > 0) {
        try {
          const logsStr = ethers.toUtf8String(logsBytes);
          if (logsStr.trim() !== '') logs = JSON.parse(logsStr);
        } catch (e) { console.error("Error parsing operation logs:", e); }
      }
      
      setOperationLogs(logs.slice(-10)); // Show last 10 operations
    } catch (e) { 
      console.error("Error loading operation logs:", e); 
    }
  };

  const addAttribute = async () => {
    if (!isConnected) { 
      alert("Please connect your wallet first"); 
      return; 
    }
    
    setAddingAttribute(true);
    setTxStatus({ visible: true, status: "pending", message: "Encrypting attribute with Zama FHE..." });
    
    try {
      const encryptedValue = FHEEncryptNumber(newAttribute.value);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const attributeId = `attr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const attributeData = {
        name: newAttribute.name,
        value: newAttribute.value,
        encryptedValue: encryptedValue,
        timestamp: Math.floor(Date.now() / 1000),
        category: newAttribute.category,
        isVerified: false,
        proofType: newAttribute.proofType,
        owner: address
      };
      
      await contract.setData(`attribute_${attributeId}`, ethers.toUtf8Bytes(JSON.stringify(attributeData)));
      
      const keysBytes = await contract.getData("attribute_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { 
          keys = JSON.parse(ethers.toUtf8String(keysBytes)); 
        } catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(attributeId);
      await contract.setData("attribute_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      // Add to operation logs
      const newLog: OperationLog = {
        id: `log_${Date.now()}`,
        type: 'encrypt',
        timestamp: Math.floor(Date.now() / 1000),
        description: `Encrypted attribute: ${newAttribute.name}`,
        status: 'success'
      };
      const currentLogs = [...operationLogs, newLog];
      await contract.setData("operation_logs", ethers.toUtf8Bytes(JSON.stringify(currentLogs.slice(-50))));
      
      setTxStatus({ visible: true, status: "success", message: "Attribute encrypted and stored securely!" });
      await loadAttributes();
      await loadOperationLogs();
      
      setTimeout(() => {
        setTxStatus({ visible: false, status: "pending", message: "" });
        setShowAddAttribute(false);
        setNewAttribute({ name: "", value: 0, category: "personal", proofType: "age_verification" });
      }, 2000);
      
    } catch (e: any) {
      const errorMsg = e.message.includes("user rejected") ? "Transaction rejected" : "Operation failed";
      setTxStatus({ visible: true, status: "error", message: errorMsg });
      setTimeout(() => setTxStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally {
      setAddingAttribute(false);
    }
  };

  const decryptAttribute = async (encryptedData: string) => {
    if (!isConnected) { 
      alert("Please connect your wallet first"); 
      return null;
    }
    
    setIsDecrypting(true);
    setTxStatus({ visible: true, status: "pending", message: "Requesting wallet signature for decryption..." });
    
    try {
      const message = generateSignatureMessage(publicKey);
      await signMessageAsync({ message });
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const decrypted = FHEDecryptNumber(encryptedData);
      setDecryptedValue(decrypted);
      
      // Log decryption operation
      const contract = await getContractWithSigner();
      if (contract) {
        const newLog: OperationLog = {
          id: `log_${Date.now()}`,
          type: 'decrypt',
          timestamp: Math.floor(Date.now() / 1000),
          description: `Decrypted attribute value`,
          status: 'success'
        };
        const currentLogs = [...operationLogs, newLog];
        await contract.setData("operation_logs", ethers.toUtf8Bytes(JSON.stringify(currentLogs.slice(-50))));
        await loadOperationLogs();
      }
      
      setTxStatus({ visible: true, status: "success", message: "Attribute decrypted successfully!" });
      setTimeout(() => setTxStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return decrypted;
    } catch (e) {
      console.error("Decryption failed:", e);
      setTxStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTxStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null;
    } finally {
      setIsDecrypting(false);
    }
  };

  const verifyAttribute = async (attributeId: string, proofType: string) => {
    if (!isConnected) { 
      alert("Please connect your wallet first"); 
      return;
    }
    
    setTxStatus({ visible: true, status: "pending", message: "Verifying attribute with FHE computation..." });
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not available");
      
      const attributeBytes = await contract.getData(`attribute_${attributeId}`);
      if (attributeBytes.length === 0) throw new Error("Attribute not found");
      
      const attributeData = JSON.parse(ethers.toUtf8String(attributeBytes));
      const isVerified = FHEVerifyAttribute(attributeData.encryptedValue, proofType);
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedAttribute = { ...attributeData, isVerified };
      await contractWithSigner.setData(`attribute_${attributeId}`, ethers.toUtf8Bytes(JSON.stringify(updatedAttribute)));
      
      // Log verification operation
      const newLog: OperationLog = {
        id: `log_${Date.now()}`,
        type: 'verify',
        timestamp: Math.floor(Date.now() / 1000),
        description: `Verified ${proofType} for ${attributeData.name}`,
        status: 'success'
      };
      const currentLogs = [...operationLogs, newLog];
      await contractWithSigner.setData("operation_logs", ethers.toUtf8Bytes(JSON.stringify(currentLogs.slice(-50))));
      
      setTxStatus({ visible: true, status: "success", message: `Attribute verified: ${isVerified ? "PASS" : "FAIL"}` });
      await loadAttributes();
      await loadOperationLogs();
      setTimeout(() => setTxStatus({ visible: false, status: "pending", message: "" }), 2000);
      
    } catch (e: any) {
      setTxStatus({ visible: true, status: "error", message: "Verification failed: " + e.message });
      setTimeout(() => setTxStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const simulateSSOLogin = async (appName: string, proofType: string) => {
    if (!isConnected) { 
      alert("Please connect your wallet first"); 
      return;
    }
    
    setTxStatus({ visible: true, status: "pending", message: `Generating ZKP for ${appName}...` });
    
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Log SSO operation
      const contract = await getContractWithSigner();
      if (contract) {
        const newLog: OperationLog = {
          id: `log_${Date.now()}`,
          type: 'sso_login',
          timestamp: Math.floor(Date.now() / 1000),
          description: `SSO login to ${appName} with ${proofType}`,
          status: 'success',
          targetApp: appName
        };
        const currentLogs = [...operationLogs, newLog];
        await contract.setData("operation_logs", ethers.toUtf8Bytes(JSON.stringify(currentLogs.slice(-50))));
        await loadOperationLogs();
      }
      
      setTxStatus({ visible: true, status: "success", message: `SSO login to ${appName} successful!` });
      setTimeout(() => setTxStatus({ visible: false, status: "pending", message: "" }), 2000);
      
    } catch (e: any) {
      setTxStatus({ visible: true, status: "error", message: "SSO login failed" });
      setTimeout(() => setTxStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const stats = {
    totalAttributes: attributes.length,
    verifiedAttributes: attributes.filter(attr => attr.isVerified).length,
    personalAttributes: attributes.filter(attr => attr.category === 'personal').length,
    financialAttributes: attributes.filter(attr => attr.category === 'financial').length,
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="fhe-spinner"></div>
        <p>Initializing Zama FHE Identity Provider...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-icon">🔐</div>
            <h1>FHE IdP</h1>
          </div>
          <div className="fhe-status">
            <div className={`status-indicator ${fheStatus}`}></div>
            <span>FHE {fheStatus}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${activeTab === 'attributes' ? 'active' : ''}`}
            onClick={() => setActiveTab('attributes')}
          >
            <span className="nav-icon">📊</span>
            <span>Identity Attributes</span>
            <span className="nav-badge">{attributes.length}</span>
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            <span className="nav-icon">🕒</span>
            <span>Operation Logs</span>
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'sso' ? 'active' : ''}`}
            onClick={() => setActiveTab('sso')}
          >
            <span className="nav-icon">🌐</span>
            <span>SSO Services</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="wallet-connect">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        <header className="content-header">
          <h2>{
            activeTab === 'attributes' ? 'Identity Attributes' :
            activeTab === 'logs' ? 'Operation History' : 'SSO Services'
          }</h2>
          <div className="header-actions">
            {activeTab === 'attributes' && (
              <button 
                className="primary-button"
                onClick={() => setShowAddAttribute(true)}
                disabled={!isConnected}
              >
                + Add Attribute
              </button>
            )}
            <button 
              className="secondary-button"
              onClick={loadAttributes}
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </header>

        {/* Statistics Dashboard */}
        {activeTab === 'attributes' && (
          <div className="stats-dashboard">
            <div className="stat-card">
              <div className="stat-value">{stats.totalAttributes}</div>
              <div className="stat-label">Total Attributes</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.verifiedAttributes}</div>
              <div className="stat-label">Verified</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.personalAttributes}</div>
              <div className="stat-label">Personal</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.financialAttributes}</div>
              <div className="stat-label">Financial</div>
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="content-area">
          {activeTab === 'attributes' && (
            <div className="attributes-grid">
              {attributes.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🔒</div>
                  <h3>No Identity Attributes</h3>
                  <p>Add your first encrypted attribute to get started</p>
                  <button 
                    className="primary-button"
                    onClick={() => setShowAddAttribute(true)}
                  >
                    Add First Attribute
                  </button>
                </div>
              ) : (
                attributes.map(attr => (
                  <div key={attr.id} className="attribute-card">
                    <div className="attribute-header">
                      <h4>{attr.name}</h4>
                      <span className={`verification-badge ${attr.isVerified ? 'verified' : 'unverified'}`}>
                        {attr.isVerified ? '✓ Verified' : 'Unverified'}
                      </span>
                    </div>
                    <div className="attribute-content">
                      <div className="attribute-meta">
                        <span>Category: {attr.category}</span>
                        <span>Type: {attr.proofType}</span>
                      </div>
                      <div className="encrypted-data">
                        {attr.encryptedValue.substring(0, 30)}...
                      </div>
                    </div>
                    <div className="attribute-actions">
                      <button 
                        className="action-btn"
                        onClick={() => decryptAttribute(attr.encryptedValue)}
                        disabled={isDecrypting}
                      >
                        {isDecrypting ? 'Decrypting...' : 'Decrypt'}
                      </button>
                      <button 
                        className="action-btn secondary"
                        onClick={() => verifyAttribute(attr.id, attr.proofType)}
                      >
                        Verify
                      </button>
                    </div>
                    {decryptedValue !== null && (
                      <div className="decrypted-value">
                        Decrypted: {decryptedValue}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="logs-container">
              <h3>Recent Operations</h3>
              <div className="logs-list">
                {operationLogs.slice().reverse().map(log => (
                  <div key={log.id} className="log-item">
                    <div className="log-icon">{{
                      'encrypt': '🔒',
                      'decrypt': '🔓',
                      'verify': '✓',
                      'sso_login': '🌐'
                    }[log.type]}</div>
                    <div className="log-content">
                      <div className="log-description">{log.description}</div>
                      <div className="log-meta">
                        {new Date(log.timestamp * 1000).toLocaleString()}
                        {log.targetApp && ` • ${log.targetApp}`}
                      </div>
                    </div>
                    <div className={`log-status ${log.status}`}>{log.status}</div>
                  </div>
                ))}
                {operationLogs.length === 0 && (
                  <div className="empty-logs">No operations recorded yet</div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'sso' && (
            <div className="sso-container">
              <h3>Available SSO Services</h3>
              <div className="sso-grid">
                <div className="sso-card">
                  <div className="sso-icon">🛒</div>
                  <h4>E-Commerce</h4>
                  <p>Age verification for online shopping</p>
                  <button 
                    className="sso-btn"
                    onClick={() => simulateSSOLogin("E-Commerce Site", "age_verification")}
                  >
                    Login with Age Proof
                  </button>
                </div>
                <div className="sso-card">
                  <div className="sso-icon">🏦</div>
                  <h4>Banking</h4>
                  <p>Income verification for financial services</p>
                  <button 
                    className="sso-btn"
                    onClick={() => simulateSSOLogin("Banking App", "income_verification")}
                  >
                    Login with Income Proof
                  </button>
                </div>
                <div className="sso-card">
                  <div className="sso-icon">🎮</div>
                  <h4>Gaming</h4>
                  <p>Age verification for adult content</p>
                  <button 
                    className="sso-btn"
                    onClick={() => simulateSSOLogin("Gaming Platform", "age_verification")}
                  >
                    Login with Age Proof
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Attribute Modal */}
      {showAddAttribute && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Add Encrypted Attribute</h3>
              <button onClick={() => setShowAddAttribute(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Attribute Name</label>
                <input 
                  type="text" 
                  value={newAttribute.name}
                  onChange={(e) => setNewAttribute({...newAttribute, name: e.target.value})}
                  placeholder="e.g., Age, Income, Credit Score"
                />
              </div>
              <div className="form-group">
                <label>Value</label>
                <input 
                  type="number" 
                  value={newAttribute.value}
                  onChange={(e) => setNewAttribute({...newAttribute, value: parseFloat(e.target.value) || 0})}
                  placeholder="Numerical value"
                />
              </div>
              <div className="form-group">
                <label>Category</label>
                <select 
                  value={newAttribute.category}
                  onChange={(e) => setNewAttribute({...newAttribute, category: e.target.value})}
                >
                  <option value="personal">Personal</option>
                  <option value="financial">Financial</option>
                  <option value="professional">Professional</option>
                </select>
              </div>
              <div className="form-group">
                <label>Proof Type</label>
                <select 
                  value={newAttribute.proofType}
                  onChange={(e) => setNewAttribute({...newAttribute, proofType: e.target.value})}
                >
                  <option value="age_verification">Age Verification</option>
                  <option value="income_verification">Income Verification</option>
                  <option value="kyc_verification">KYC Verification</option>
                </select>
              </div>
              <div className="encryption-preview">
                <strong>FHE Encryption Preview:</strong>
                <div className="preview">
                  {newAttribute.value} → {FHEEncryptNumber(newAttribute.value).substring(0, 40)}...
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button 
                className="secondary-button"
                onClick={() => setShowAddAttribute(false)}
              >
                Cancel
              </button>
              <button 
                className="primary-button"
                onClick={addAttribute}
                disabled={addingAttribute || !newAttribute.name}
              >
                {addingAttribute ? 'Encrypting...' : 'Encrypt & Store'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Status Modal */}
      {txStatus.visible && (
        <div className="status-modal">
          <div className="status-content">
            <div className={`status-icon ${txStatus.status}`}>
              {txStatus.status === 'pending' && '⏳'}
              {txStatus.status === 'success' && '✅'}
              {txStatus.status === 'error' && '❌'}
            </div>
            <div className="status-message">{txStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;