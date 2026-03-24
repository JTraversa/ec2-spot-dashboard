export default function Footer() {
  return (
    <div className="dashboard-footer">
      <div className="footer-note">
        Note: AWS EC2 pricing varies by model. <strong>Spot</strong> prices fluctuate based on spare capacity — from 2009-2017 via{' '}
        <a href="https://www.researchgate.net/publication/221276558" target="_blank" rel="noopener noreferrer">
          auction
        </a>, and since November 2017 via an{' '}
        <a href="https://www.researchgate.net/publication/333939795" target="_blank" rel="noopener noreferrer">
          algorithm-based supply/demand model
        </a>{' '}
        (Baughman et al.). <strong>On-demand</strong> and <strong>reserved instance</strong> prices are set by AWS and change infrequently.
      </div>
      <div className="footer-top">
        <div className="footer-section">
          <h4>Spot Price Data</h4>
          <ul>
            <li><a href="https://zenodo.org/records/15003060" target="_blank" rel="noopener noreferrer">USC/ISI EC2 Spot Price Archive</a> — 2014-2023 (Calvin Ardi)</li>
            <li><a href="https://zenodo.org/records/18821638" target="_blank" rel="noopener noreferrer">AWS Spot Price History</a> — 2024-2026 (Eric Pauley)</li>
            <li><a href="https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeSpotPriceHistory.html" target="_blank" rel="noopener noreferrer">AWS DescribeSpotPriceHistory API</a> — Rolling 90 days</li>
          </ul>
        </div>
        <div className="footer-section">
          <h4>On-Demand &amp; RI Data</h4>
          <ul>
            <li><a href="https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api.html" target="_blank" rel="noopener noreferrer">AWS Price List Bulk API</a> — 116 historical versions (2015-present)</li>
            <li>On-demand, 1yr RI, and 3yr RI pricing across all tracked instance types</li>
          </ul>
        </div>
        <div className="footer-section">
          <h4>Research</h4>
          <ul>
            <li><a href="https://www.researchgate.net/publication/221276558" target="_blank" rel="noopener noreferrer">Ben-Yehuda et al. (2011)</a> — Deconstructing EC2 Spot Pricing</li>
            <li><a href="https://www.researchgate.net/publication/333939795" target="_blank" rel="noopener noreferrer">Baughman et al. (2019)</a> — 2017 Spot Market Changes</li>
            <li><a href="https://www.researchgate.net/publication/373331751" target="_blank" rel="noopener noreferrer">Fragiadakis et al. (2023)</a> — ML Price Prediction</li>
            <li><a href="https://arxiv.org/pdf/2202.02973" target="_blank" rel="noopener noreferrer">SpotLake</a> — Multi-cloud dataset archive</li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <span>EC2 Pricing Dashboard — Spot data (CC0), on-demand &amp; RI data via AWS Price List API</span>
        <a href="https://zenodo.org/records/15003060" target="_blank" rel="noopener noreferrer">DOI: 10.5281/zenodo.5880793</a>
      </div>
    </div>
  )
}
