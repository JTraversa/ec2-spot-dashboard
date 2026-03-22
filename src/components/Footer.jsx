export default function Footer() {
  return (
    <div className="dashboard-footer">
      <div className="footer-note">
        Note: AWS spot pricing has undergone multiple regime changes. From 2009-2011, spot prices were{' '}
        <a href="https://www.researchgate.net/publication/221276558" target="_blank" rel="noopener noreferrer">
          artificially controlled via hidden reserve prices
        </a>{' '}
        rather than being truly market-driven (Ben-Yehuda et al.). From 2011-2017, AWS used a competitive auction
        mechanism. In November 2017, AWS{' '}
        <a href="https://www.researchgate.net/publication/333939795" target="_blank" rel="noopener noreferrer">
          shifted to an algorithm-based supply/demand model
        </a>{' '}
        (Baughman et al.), eliminating bidding entirely. Data from each era represents a fundamentally different
        pricing regime.
      </div>
      <div className="footer-top">
        <div className="footer-section">
          <h4>Primary Data Sources</h4>
          <ul>
            <li><a href="https://zenodo.org/records/15003060" target="_blank" rel="noopener noreferrer">USC/ISI EC2 Spot Price Archive</a> — Historical spot prices 2014-2023 (Calvin Ardi)</li>
            <li><a href="https://zenodo.org/records/18821638" target="_blank" rel="noopener noreferrer">AWS Spot Price History</a> — Monthly spot prices 2024-2026 (Eric Pauley)</li>
            <li><a href="https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeSpotPriceHistory.html" target="_blank" rel="noopener noreferrer">AWS EC2 DescribeSpotPriceHistory API</a> — Live spot prices (rolling 90 days)</li>
            <li><a href="https://github.com/cardi/aws-spot-price-history" target="_blank" rel="noopener noreferrer">cardi/aws-spot-price-history</a> — Automated spot price collection scripts</li>
          </ul>
        </div>
        <div className="footer-section">
          <h4>Research &amp; Analysis</h4>
          <ul>
            <li><a href="https://www.researchgate.net/publication/221276558" target="_blank" rel="noopener noreferrer">Ben-Yehuda et al. (2011)</a> — Deconstructing Amazon EC2 Spot Instance Pricing</li>
            <li><a href="https://www.researchgate.net/publication/333939795" target="_blank" rel="noopener noreferrer">Baughman et al. (2019)</a> — Deconstructing the 2017 Changes to AWS Spot Market Pricing</li>
            <li><a href="https://www.researchgate.net/publication/373331751" target="_blank" rel="noopener noreferrer">Fragiadakis et al. (2023)</a> — ML in Cloud Service Price Prediction</li>
            <li><a href="https://researchgate.net/publication/309151361" target="_blank" rel="noopener noreferrer">Caton &amp; Haas (2016)</a> — Temporal and Spatial Trend Analysis of Spot Pricing</li>
          </ul>
        </div>
        <div className="footer-section">
          <h4>Additional Resources</h4>
          <ul>
            <li><a href="https://arxiv.org/pdf/2202.02973" target="_blank" rel="noopener noreferrer">SpotLake</a> — Multi-cloud spot instance dataset archive</li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <span>EC2 Spot Price Dashboard — Data aggregated from public sources under CC0 license</span>
        <a href="https://zenodo.org/records/15003060" target="_blank" rel="noopener noreferrer">DOI: 10.5281/zenodo.5880793</a>
      </div>
    </div>
  )
}
